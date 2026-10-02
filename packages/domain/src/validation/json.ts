/** Validation shared by canonical export and operational backup. */
export function findNulPath(value: unknown): string | null {
  const pending: Array<{ readonly value: unknown; readonly path: string }> = [{ value, path: "$" }];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    if (typeof current.value === "string") {
      if (current.value.includes("\u0000")) return current.path;
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], path: `${current.path}[${index}]` });
      }
      continue;
    }
    const entries = Object.entries(current.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index] as [string, unknown];
      if (key.includes("\u0000")) return `${current.path}.<object-key-with-U+0000>`;
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
  return null;
}

export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}
