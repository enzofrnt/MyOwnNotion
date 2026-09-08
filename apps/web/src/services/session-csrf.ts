/** Shared by this renderer's HTTP clients; never persisted or sent to another origin. */
const tokens = new Map<string, string>();
function scope(baseUrl: string): string {
  return new URL(
    baseUrl || "/",
    typeof location === "undefined" ? "http://localhost" : location.origin,
  ).href.replace(/\/$/, "");
}
export function setSessionCsrf(baseUrl: string, token: string | null): void {
  if (token === null) tokens.delete(scope(baseUrl));
  else tokens.set(scope(baseUrl), token);
}
export function sessionCsrf(baseUrl: string): string | null {
  return tokens.get(scope(baseUrl)) ?? null;
}
