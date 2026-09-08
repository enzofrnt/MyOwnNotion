/** Public entry points are explicit; future HTTP routes require an owner by default. */
const PUBLIC_ROUTES = new Set([
  "/health",
  "/v1/installation/status",
  "/v1/bootstrap",
  "/v1/bootstrap/:attemptId/credential",
  "/v1/bootstrap/:attemptId/recovery/download",
  "/v1/bootstrap/:attemptId/recovery/regenerate",
  "/v1/bootstrap/:attemptId/recovery/confirm",
  "/v1/auth/login/passkey/options",
  "/v1/auth/login/passkey",
  "/v1/auth/login/password",
]);
export function requiresOwnerHttpAccess(route: string): boolean {
  return route.startsWith("/v1/") && !PUBLIC_ROUTES.has(route);
}
