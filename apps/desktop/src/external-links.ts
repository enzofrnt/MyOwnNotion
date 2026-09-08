const DANGEROUS_SCHEMES = new Set(["javascript:", "file:", "data:", "vbscript:", "about:"]);

export type ExternalLinkDecision =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: "invalid" | "forbidden-scheme" | "insecure-remote" };

export function evaluateExternalUrl(raw: string, allowInsecureLocal = true): ExternalLinkDecision {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.username || url.password) return { ok: false, reason: "invalid" };
  if (DANGEROUS_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: "forbidden-scheme" };
  }
  if (url.protocol === "https:") {
    return { ok: true, url: url.toString() };
  }
  if (url.protocol === "http:") {
    const host = url.hostname.toLowerCase();
    const local =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".localhost");
    if (local && allowInsecureLocal) {
      return { ok: true, url: url.toString() };
    }
    return { ok: false, reason: "insecure-remote" };
  }
  if (url.protocol === "mailto:") {
    return { ok: true, url: url.toString() };
  }
  return { ok: false, reason: "forbidden-scheme" };
}
