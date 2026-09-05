/** Bun's glob results use the host filesystem's path separators. */
export function requireWebAssetClasses(emittedFiles: readonly string[]): void {
  const files = emittedFiles.map((file) => file.replaceAll("\\", "/"));
  const required = [
    ["stylesheet", /\.css$/],
    ["WebAssembly", /\.wasm$/],
    ["web manifest", /\.webmanifest$/],
    ["search worker", /^assets\/search\.worker-.+\.js$/],
    ["knowledge graph worker", /^assets\/knowledge-graph\.worker-.+\.js$/],
  ] as const;
  for (const [label, pattern] of required) {
    if (!files.some((file) => pattern.test(file))) {
      throw new Error(`The web production build is missing a required asset class: ${label}`);
    }
  }
}
