import {
  type GraphProjection,
  type GraphQuery,
  type NormalizedGraphSource,
  normalizeGraphSource,
  projectGraph,
  type RawGraphSource,
} from "@myownnotion/graph";

export interface KnowledgeGraphWorkerCommand {
  readonly source: RawGraphSource;
  readonly query: GraphQuery;
}

export interface KnowledgeGraphWorkerResult {
  readonly source: NormalizedGraphSource;
  readonly projection: GraphProjection;
}

export function runKnowledgeGraphProjection(
  command: KnowledgeGraphWorkerCommand,
): KnowledgeGraphWorkerResult {
  const source = normalizeGraphSource(command.source);
  return { source, projection: projectGraph(source, command.query) };
}

type WorkerRequest = { readonly requestId: number; readonly command: KnowledgeGraphWorkerCommand };
type WorkerResponse = { readonly requestId: number; readonly result: KnowledgeGraphWorkerResult };

interface KnowledgeGraphWorkerHost {
  readonly document?: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
}

const workerHost = globalThis as unknown as KnowledgeGraphWorkerHost;
if (
  workerHost.document === undefined &&
  typeof workerHost.addEventListener === "function" &&
  typeof workerHost.postMessage === "function"
) {
  workerHost.addEventListener("message", (event) => {
    workerHost.postMessage({
      requestId: event.data.requestId,
      result: runKnowledgeGraphProjection(event.data.command),
    });
  });
}
