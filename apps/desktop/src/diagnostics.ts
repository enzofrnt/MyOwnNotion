const SECRET_KEYS = [
  "password",
  "token",
  "secret",
  "cookie",
  "authorization",
  "ciphertext",
  "privatekey",
  "recoverykit",
  "passphrase",
  "csrf",
];

export function redactDiagnostic(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactDiagnostic);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SECRET_KEYS.some((part) => key.toLowerCase().includes(part))
        ? "[redacted]"
        : redactDiagnostic(entry);
    }
    return out;
  }
  return value;
}

export function redactString(value: string): string {
  return value
    .replace(/[A-Za-z0-9+/]{32,}={0,2}/g, "[redacted]")
    .replace(/(password|token|secret|cookie)=([^\s&]+)/gi, "$1=[redacted]");
}

export function diagnosticMessage(
  code: string,
  detail: string,
): { readonly code: string; readonly message: string } {
  return { code, message: redactString(detail) };
}
