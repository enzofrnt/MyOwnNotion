import type {
  GraphProjection,
  GraphQuery,
  NormalizedGraphSource,
  RawGraphSource,
} from "@myownnotion/graph";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import {
  type KnowledgeGraphWorkerCommand,
  type KnowledgeGraphWorkerResult,
  runKnowledgeGraphProjection,
} from "./knowledge-graph.worker.ts";

declare const __MYOWNNOTION_GRAPH_WORKER_URL__: string | undefined;

const GRAPH_WORKER_TIMEOUT_MS = 20_000;

function knowledgeGraphWorkerUrl(): URL {
  if (typeof __MYOWNNOTION_GRAPH_WORKER_URL__ === "string") {
    return new URL(__MYOWNNOTION_GRAPH_WORKER_URL__, window.location.origin);
  }
  return new URL("./knowledge-graph.worker.ts", import.meta.url);
}

class KnowledgeGraphWorkerClient {
  readonly #worker = new Worker(knowledgeGraphWorkerUrl(), { type: "module" });
  readonly #pending = new Map<
    number,
    {
      readonly resolve: (result: KnowledgeGraphWorkerResult) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  #requestId = 0;

  constructor() {
    this.#worker.addEventListener(
      "message",
      (
        event: MessageEvent<{
          readonly requestId: number;
          readonly result: KnowledgeGraphWorkerResult;
        }>,
      ) => {
        const pending = this.#pending.get(event.data.requestId);
        if (pending === undefined) return;
        this.#pending.delete(event.data.requestId);
        clearTimeout(pending.timeout);
        pending.resolve(event.data.result);
      },
    );
    this.#worker.addEventListener("error", () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Knowledge graph worker failed"));
      }
      this.#pending.clear();
    });
  }

  request(command: KnowledgeGraphWorkerCommand): Promise<KnowledgeGraphWorkerResult> {
    this.#requestId += 1;
    const requestId = this.#requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(requestId)) return;
        reject(new Error("Knowledge graph worker did not answer"));
      }, GRAPH_WORKER_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timeout });
      this.#worker.postMessage({ requestId, command });
    });
  }
}

let workerClient: KnowledgeGraphWorkerClient | null = null;

function projectKnowledgeGraph(
  source: RawGraphSource,
  query: GraphQuery,
): Promise<KnowledgeGraphWorkerResult> {
  if (typeof Worker !== "function") {
    return Promise.resolve(runKnowledgeGraphProjection({ source, query }));
  }
  workerClient ??= new KnowledgeGraphWorkerClient();
  return workerClient.request({ source, query });
}

export interface KnowledgeGraphState {
  readonly status: "loading" | "rebuilding" | "ready" | "stale" | "unavailable";
  readonly projection: GraphProjection | null;
  readonly source: NormalizedGraphSource | null;
  readonly errorCode: "graph.projection-failed" | null;
  readonly retry: () => void;
}

function yieldToInterface(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function useKnowledgeGraph(
  service: LocalContentService,
  query: GraphQuery,
): KnowledgeGraphState {
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<KnowledgeGraphState["status"]>("loading");
  const [projection, setProjection] = useState<GraphProjection | null>(null);
  const projectionRef = useRef<GraphProjection | null>(null);
  const [source, setSource] = useState<NormalizedGraphSource | null>(null);
  const [errorCode, setErrorCode] = useState<KnowledgeGraphState["errorCode"]>(null);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(
    () => service.subscribeProjection(() => setGeneration((value) => value + 1)),
    [service],
  );

  useEffect(() => {
    // Projection changes and manual retries both invalidate this derivation.
    // Reading the generation here makes that invalidation an explicit input.
    void generation;
    let cancelled = false;
    void (async () => {
      setStatus(projectionRef.current === null ? "loading" : "rebuilding");
      try {
        const topology = await service.getKnowledgeGraphTopology();
        const preliminaryResult = await projectKnowledgeGraph(topology, query);
        const normalizedTopology = preliminaryResult.source;
        const preliminary = preliminaryResult.projection;
        const needsMedia = query.filters.mediaTypes.length > 0;
        const needsStructured = query.filters.structured.length > 0;
        const hydrationIds = needsStructured
          ? normalizedTopology.nodes.map(({ id }) => id)
          : needsMedia
            ? normalizedTopology.nodes.filter(({ kind }) => kind === "file").map(({ id }) => id)
            : preliminary.nodes.map(({ id }) => id);
        await yieldToInterface();
        const hydrated = await service.hydrateKnowledgeGraphNodes(hydrationIds);
        if (cancelled) return;
        const byId = new Map(hydrated.map((node) => [node.id, node]));
        const result = await projectKnowledgeGraph(
          {
            ...topology,
            nodes: topology.nodes.map((node) => byId.get(node.id) ?? node),
          },
          query,
        );
        if (cancelled) return;
        setSource(result.source);
        projectionRef.current = result.projection;
        setProjection(result.projection);
        setErrorCode(null);
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setErrorCode("graph.projection-failed");
        setStatus(projectionRef.current === null ? "unavailable" : "stale");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation, query, service]);

  return { status, projection, source, errorCode, retry };
}
