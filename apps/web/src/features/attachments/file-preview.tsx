import type { FileContentMetadataDto, ProblemDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
import { formatByteLength } from "../hierarchy/file-node.tsx";

export type FilePreviewState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "available";
      readonly metadata: FileContentMetadataDto;
      readonly source: "network" | "offline-cache";
      readonly previewUrl: string | null;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "not-cached" | "stale" | "integrity" | "unavailable";
      readonly problem: ProblemDto;
    };

function unavailableReason(
  problem: ProblemDto,
  offline: boolean,
): Extract<FilePreviewState, { kind: "unavailable" }>["reason"] {
  if (offline) return "not-cached";
  if (problem.code === "file.stale-revision") return "stale";
  if (problem.code === "file.integrity-failed") return "integrity";
  return "unavailable";
}

const UNAVAILABLE_LABELS = {
  "not-cached": "Unavailable offline — this revision was not cached",
  stale: "Unavailable — a newer file revision exists",
  integrity: "Unavailable — file integrity verification failed",
  unavailable: "File content is currently unavailable",
} as const;

export function FilePreviewView({
  name,
  downloadUrl,
  state,
  onPreview,
}: {
  readonly name: string;
  readonly downloadUrl: string;
  readonly state: FilePreviewState;
  readonly onPreview?: () => void;
}) {
  if (state.kind === "loading") {
    return <p className="muted file-preview-status">Checking file availability…</p>;
  }
  if (state.kind === "unavailable") {
    return (
      <p className="status-banner file-preview-status" data-state="error" role="alert">
        {UNAVAILABLE_LABELS[state.reason]}
      </p>
    );
  }
  const { metadata } = state;
  return (
    <div className="file-preview" data-source={state.source}>
      <dl className="file-metadata" aria-label={`Metadata for ${name}`}>
        <div>
          <dt>Type</dt>
          <dd>{metadata.mediaType}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatByteLength(metadata.byteLength)}</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd title={metadata.sha256}>{`${metadata.sha256.slice(0, 12)}…`}</dd>
        </div>
      </dl>
      <p className="muted file-preview-status" role="status">
        {state.source === "offline-cache"
          ? "Cached revision — available offline"
          : metadata.cacheEligibility
            ? "Available online · eligible for offline cache after opening"
            : "Available online only · exceeds the offline cache limit"}
      </p>
      <div className="file-preview-actions">
        {metadata.disposition === "inline" ? (
          <button type="button" onClick={onPreview} disabled={state.previewUrl !== null}>
            {state.previewUrl === null ? `Preview ${name}` : "Preview loaded"}
          </button>
        ) : null}
        <a href={downloadUrl} download={metadata.name}>
          Download {name}
        </a>
      </div>
      {state.previewUrl !== null ? (
        <figure className="file-raster-preview">
          <img src={state.previewUrl} alt={`Preview of ${name}`} />
          <figcaption>{name}</figcaption>
        </figure>
      ) : null}
    </div>
  );
}

export function FilePreview({
  itemId,
  revisionId,
  name,
  api: suppliedApi,
}: {
  readonly itemId: Uuid;
  readonly revisionId: Uuid;
  readonly name: string;
  readonly api?: ContentApi;
}) {
  const api = useMemo(() => suppliedApi ?? new ContentApi(), [suppliedApi]);
  const [state, setState] = useState<FilePreviewState>({ kind: "loading" });
  const previewUrl = state.kind === "available" ? state.previewUrl : null;

  useEffect(
    () => () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  useEffect(() => {
    let active = true;
    const inspect = async (): Promise<void> => {
      const result = await api.inspectFileContent(itemId, revisionId, name);
      if (!active) return;
      if (result.ok) {
        setState({
          kind: "available",
          metadata: result.value,
          source: "network",
          previewUrl: null,
        });
        return;
      }
      if (result.offline) {
        const cached = await api.fetchFileContent(itemId, revisionId, name);
        if (!active) return;
        if (cached.ok) {
          const cachedPreviewUrl =
            cached.value.metadata.disposition === "inline"
              ? URL.createObjectURL(cached.value.blob)
              : null;
          setState({
            kind: "available",
            metadata: cached.value.metadata,
            source: "offline-cache",
            previewUrl: cachedPreviewUrl,
          });
          return;
        }
      }
      setState({
        kind: "unavailable",
        reason: unavailableReason(result.problem, result.offline),
        problem: result.problem,
      });
    };
    void inspect();
    return () => {
      active = false;
    };
  }, [api, itemId, name, revisionId]);

  const loadPreview = useCallback(async () => {
    const result = await api.fetchFileContent(itemId, revisionId, name);
    if (!result.ok) {
      setState({
        kind: "unavailable",
        reason: unavailableReason(result.problem, result.offline),
        problem: result.problem,
      });
      return;
    }
    const previewUrl = URL.createObjectURL(result.value.blob);
    setState({
      kind: "available",
      metadata: result.value.metadata,
      source: result.value.source,
      previewUrl,
    });
  }, [api, itemId, name, revisionId]);

  return (
    <FilePreviewView
      name={name}
      downloadUrl={api.fileContentUrl(itemId, revisionId)}
      state={state}
      onPreview={() => void loadPreview()}
    />
  );
}
