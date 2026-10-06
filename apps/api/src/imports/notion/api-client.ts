import { createHash } from "node:crypto";
import { NotionImportError } from "./source.ts";

export const NOTION_VERSION = "2026-03-11";
export type NotionObject = Record<string, unknown>;
export const object = (value: unknown): NotionObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NotionObject)
    : {};
export const objects = (value: unknown): NotionObject[] =>
  Array.isArray(value) ? value.map(object) : [];
export const string = (value: unknown): string => (typeof value === "string" ? value : "");
export function sourceId(value: unknown): string {
  const id = string(value).replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new NotionImportError("import.invalid-source-id");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
export function title(value: NotionObject): string {
  const property = Object.values(object(value["properties"]))
    .map(object)
    .find((entry) => entry["type"] === "title");
  return (
    plainText(value["title"] ?? property?.["title"]).trim() || string(value["name"]) || "Sans titre"
  );
}
export const plainText = (value: unknown) =>
  objects(value)
    .map(
      (part) =>
        string(part["plain_text"]) ||
        string(object(part["text"])["content"]) ||
        string(object(part["equation"])["expression"]),
    )
    .join("");
export function parentId(value: NotionObject): string | null {
  const parent = object(value["parent"]);
  const id = parent[string(parent["type"])];
  return typeof id === "string" ? sourceId(id) : null;
}
export function checkAbort(signal?: AbortSignal | undefined): void {
  if (signal?.aborted) throw new NotionImportError("import.cancelled");
}
export function delay(ms: number, signal?: AbortSignal | undefined): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new NotionImportError("import.cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new NotionImportError("import.source-too-large");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new NotionImportError("import.source-too-large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
interface Scheduler {
  tail: Promise<void>;
  next: number;
}
const schedulers = new Map<string, Scheduler>();
export interface NotionClientOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal | undefined;
  sleep?: (ms: number, signal?: AbortSignal | undefined) => Promise<void>;
  now?: () => number;
}
export class NotionApiClient {
  readonly #token: string;
  readonly #scheduler: Scheduler;
  readonly #options: NotionClientOptions;
  constructor(token: string, options: NotionClientOptions = {}) {
    if (!token.trim() || /[\r\n]/.test(token)) throw new NotionImportError("import.token-required");
    this.#token = token.trim();
    this.#options = options;
    const key = createHash("sha256").update(this.#token).digest("hex");
    this.#scheduler = schedulers.get(key) ?? { tail: Promise.resolve(), next: 0 };
    schedulers.set(key, this.#scheduler);
  }
  async request(path: string, body?: NotionObject): Promise<NotionObject> {
    if (
      !/^\/(?:users\/me|search|pages\/[a-f0-9-]+(?:\/properties\/[^/?]+)?|blocks\/[a-f0-9-]+(?:\/children)?|databases\/[a-f0-9-]+|data_sources\/[a-f0-9-]+(?:\/query)?|views(?:\/[a-f0-9-]+)?)(?:\?.*)?$/.test(
        path,
      ) ||
      (body !== undefined &&
        path !== "/search" &&
        !/^\/data_sources\/[a-f0-9-]+\/query$/.test(path))
    )
      throw new NotionImportError("import.invalid-endpoint");
    const previous = this.#scheduler.tail;
    let release = () => {};
    this.#scheduler.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const signal = this.#options.signal;
    const sleep = this.#options.sleep ?? delay;
    const now = this.#options.now ?? Date.now;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        checkAbort(signal);
        await sleep(Math.max(0, this.#scheduler.next - now()), signal);
        this.#scheduler.next = now() + 350;
        let response: Response;
        try {
          response = await (this.#options.fetch ?? fetch)(`https://api.notion.com/v1${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
              Authorization: `Bearer ${this.#token}`,
              "Notion-Version": NOTION_VERSION,
              "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
              : AbortSignal.timeout(30_000),
            redirect: "error",
          });
        } catch {
          checkAbort(signal);
          if (attempt === 4) throw new NotionImportError("import.notion-unavailable");
          await sleep(500 * 2 ** attempt, signal);
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          const retry = response.headers.get("retry-after");
          const seconds = retry === null ? NaN : Number(retry);
          const date = retry === null ? NaN : Date.parse(retry);
          const requested = Number.isFinite(seconds) ? seconds * 1000 : date - now();
          await response.body?.cancel();
          if (attempt === 4 || requested > 120_000)
            throw new NotionImportError("import.notion-retry-exhausted");
          await sleep(
            Math.max(500 * 2 ** attempt + Math.floor(Math.random() * 200), requested || 0),
            signal,
          );
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new NotionImportError(
            response.status === 401
              ? "import.notion-unauthorized"
              : response.status === 403
                ? "import.notion-forbidden"
                : response.status === 404
                  ? "import.notion-not-found"
                  : "import.notion-request-refused",
            path.split("?")[0],
          );
        }
        try {
          return object(
            JSON.parse(new TextDecoder().decode(await boundedBytes(response, 8 * 1024 * 1024))),
          );
        } catch (error) {
          checkAbort(signal);
          if (error instanceof NotionImportError) throw error;
          throw new NotionImportError("import.notion-invalid-response");
        }
      }
      throw new NotionImportError("import.notion-retry-exhausted");
    } finally {
      release();
    }
  }
  async paginate(path: string, body?: NotionObject): Promise<NotionObject[]> {
    const result: NotionObject[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const parameters = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
      const response = body
        ? await this.request(path, { ...body, ...parameters })
        : await this.request(
            `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(Object.entries(parameters).map(([k, v]) => [k, String(v)] as [string, string]))}`,
          );
      if (
        response["object"] !== "list" ||
        !Array.isArray(response["results"]) ||
        typeof response["has_more"] !== "boolean"
      )
        throw new NotionImportError("import.notion-invalid-response");
      result.push(...objects(response["results"]));
      if (result.length > 10_000) throw new NotionImportError("import.source-too-large");
      if (!response["has_more"]) break;
      cursor = string(response["next_cursor"]);
      if (!cursor || cursors.has(cursor))
        throw new NotionImportError("import.notion-invalid-cursor");
      cursors.add(cursor);
    } while (cursor !== undefined);
    return result;
  }
  discover() {
    return this.paginate("/search", {});
  }
}
