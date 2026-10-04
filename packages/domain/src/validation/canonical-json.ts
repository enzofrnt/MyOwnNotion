/** General sorted-key JSON. Array order and the caller's primitive policy are preserved. */
export function canonicalJson(
  value: unknown,
  serializePrimitive: (value: unknown) => string = JSON.stringify,
): string {
  if (Array.isArray(value))
    return `[${value.map((child) => canonicalJson(child, serializePrimitive)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], serializePrimitive)}`,
      )
      .join(",")}}`;
  }
  return serializePrimitive(value);
}
