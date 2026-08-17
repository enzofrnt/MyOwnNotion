/**
 * What this device is holding, and what it may release (T041, US4, FR-019).
 *
 * A total is a number; a breakdown is an answer. FR-019 asks that the owner be
 * able to see what is holding the space, because the useful question is not
 * "how full am I" but "what would I have to give up".
 *
 * The panel also states whether the browser granted durable storage. That
 * matters more than it looks: without durability the browser may clear this
 * origin under pressure, and unsynchronized work would go with it. An owner who
 * knows can act; an owner who does not simply loses something one day.
 */

import {
  measure,
  requestDurability,
  type StorageMeasurement,
  writeLimit,
} from "@myownnotion/client-core";
import { useCallback, useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { formatByteLength } from "../hierarchy/file-node.tsx";

export function StoragePanel({ service }: { readonly service: LocalContentService }) {
  const [measurement, setMeasurement] = useState<StorageMeasurement | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setMeasurement(await measure(service.db));
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setLimit = useCallback(
    async (limitBytes: number | null) => {
      setBusy(true);
      await writeLimit(service.db, limitBytes);
      await refresh();
      setBusy(false);
    },
    [service, refresh],
  );

  if (measurement === null) {
    return (
      <section className="panel" aria-label="Device storage">
        <p className="muted" role="status" aria-busy="true">
          Measuring what this device is holding…
        </p>
      </section>
    );
  }

  const limit = measurement.limitBytes;
  return (
    <section className="panel" aria-label="Device storage" data-testid="storage-panel">
      <h2>This device</h2>

      <p data-testid="storage-usage">
        <strong>{formatByteLength(measurement.usedBytes)}</strong> in use
        {limit === null ? " — no limit set" : ` of ${formatByteLength(limit)}`}
      </p>

      <p className="muted" data-testid="storage-durability">
        {measurement.persisted
          ? "This browser has agreed to keep your data."
          : "This browser has not promised to keep your data. Unsent changes could be cleared if the device runs short of space."}
      </p>
      {!measurement.persisted ? (
        <button
          type="button"
          data-testid="storage-request-durability"
          disabled={busy}
          onClick={() => void requestDurability().then(() => refresh())}
        >
          Ask this browser to keep it
        </button>
      ) : null}

      <h3>What is holding the space</h3>
      <ul className="tree" data-testid="storage-breakdown">
        {measurement.breakdown.map((entry) => (
          <li key={entry.label} className="tree-row">
            <span className="tree-name">{entry.label}</span>
            <span className="muted">{entry.bytes > 0 ? formatByteLength(entry.bytes) : "—"}</span>
          </li>
        ))}
      </ul>

      <div className="field-row">
        <label htmlFor="storage-limit" className="muted">
          Limit for this device
        </label>
        <select
          id="storage-limit"
          data-testid="storage-limit"
          value={limit === null ? "unlimited" : String(limit)}
          disabled={busy}
          onChange={(event) =>
            void setLimit(event.target.value === "unlimited" ? null : Number(event.target.value))
          }
        >
          <option value={String(1024 * 1024 * 1024)}>1 GB</option>
          <option value={String(5 * 1024 * 1024 * 1024)}>5 GB</option>
          <option value={String(20 * 1024 * 1024 * 1024)}>20 GB</option>
          {/* Unlimited is the absence of a limit, offered as its own choice
              rather than as an implausibly large number. */}
          <option value="unlimited">No limit</option>
        </select>
      </div>

      <p className="muted">
        When the limit is reached, this device releases content the server can return, oldest and
        largest first. Unsent changes, unresolved conflicts, and anything you marked to keep offline
        are never released.
      </p>
    </section>
  );
}
