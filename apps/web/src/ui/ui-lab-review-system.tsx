import type { FullBackupStatus } from "@myownnotion/contracts";
import { useState } from "react";
import { BackupPanel, type BackupStatus } from "../features/backup/backup-panel.tsx";
import { FullBackupPanel } from "../features/backup/full-backup-panel.tsx";
import { ConnectionStatus } from "../features/connection/connection-status.tsx";
import { DesktopVaultNotice } from "../features/security/desktop-vault-status.tsx";
import { KeyRotationPanel } from "../features/security/key-rotation-panel.tsx";
import { type KitDelivery, RecoveryKitPanel } from "../features/security/recovery-kit-panel.tsx";
import { RecoveryReadinessPanel } from "../features/security/recovery-readiness-panel.tsx";
import { RecoveryReplacementPanel } from "../features/security/recovery-replacement-panel.tsx";
import { LegacyRecoveryList } from "../features/sync/legacy-recovery-list.tsx";
import { DesktopUpdateSurface } from "../features/update/desktop-update-panel.tsx";
import type { ContentApi } from "../services/content-api.ts";
import type { LocalContentService } from "../services/local-content.ts";
import type { KeyAvailability } from "../types/desktop-runtime.d.ts";
import { Button, NativeSelect, Section } from "./primitives/index.ts";
import { reviewId } from "./ui-lab-review-fixtures.ts";

const notice = "Conservez le kit hors ligne avec le fichier de clé de déploiement.";
const expires = "2026-10-03T18:00:00Z";
const legacySnapshot = { quarantinedRecoveryCount: 1 };
const legacyService = {
  subscribe: () => () => undefined,
  getSnapshot: () => legacySnapshot,
  getItem: async () => ({
    name: "Un ancien brouillon avec un titre particulièrement long, conservé sur cet appareil",
  }),
  legacyConflictRecovery: {
    list: async () => [
      {
        mutationId: reviewId(91),
        pageId: reviewId(42),
        status: "quarantined",
        reasonCode: "legacy-recovery.diff-unprovable",
        capturedAt: "2026-10-03T10:00:00Z",
      },
    ],
    retainedConflict: async () => null,
  },
} as unknown as LocalContentService;
const healthApi = {
  health: async () => ({ ok: true, value: { schemaVersion: 1 } }),
} as unknown as ContentApi;

export function ReviewRecovery() {
  const [delivery, setDelivery] = useState<KitDelivery>("downloadable");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="settings-content">
      <RecoveryReadinessPanel
        status={{
          active: ready ? { kitId: reviewId(90), recoveryEpoch: 1, confirmedAt: expires } : null,
          pending: null,
          notice,
        }}
        busy={false}
        onPrepareReplacement={async () => setReady(!ready)}
        onRevoke={async () => setReady(false)}
      />
      <RecoveryKitPanel
        kitId={reviewId(90)}
        delivery={delivery}
        downloadExpiresAt={expires}
        busy={false}
        onDownload={async () => setDelivery("download-consumed")}
        onRegenerate={async () => setDelivery("downloadable")}
        onConfirm={async () => setReady(true)}
      />
      <RecoveryReplacementPanel
        kit={{ kitId: reviewId(92), downloadExpiresAt: expires, notice }}
        delivery={delivery}
        downloadSaved={delivery === "download-consumed"}
        busy={false}
        onDownload={async () => setDelivery("download-consumed")}
        onConfirm={async () => setMessage("Exemple confirmé localement, aucune clé modifiée.")}
        {...(message === null ? {} : { message: { kind: "info" as const, text: message } })}
      />
      <KeyRotationPanel
        writesAllowed={false}
        policies={[
          {
            kind: "wrapping-key",
            state: "write-block",
            dueAt: expires,
            writeBlockAt: expires,
            lastCompletedAt: null,
            currentVersionOrGeneration: 1,
            nextAction: "start-rotation-urgently",
          },
          {
            kind: "data-key",
            state: "in-progress",
            dueAt: expires,
            writeBlockAt: expires,
            lastCompletedAt: null,
            currentVersionOrGeneration: 1,
            nextAction: "resume-rotation",
          },
        ]}
        running={[
          {
            operationId: reviewId(93),
            kind: "data-key",
            phase: "rewriting",
            processedCount: 4812,
            totalCount: 7700,
          },
        ]}
      />
      <LegacyRecoveryList service={legacyService} />
    </div>
  );
}

export function ReviewDesktop() {
  const [vault, setVault] = useState<KeyAvailability>("missing");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  return (
    <div className="settings-content">
      <Section aria-label="État du coffre local">
        <h2>Coffre local</h2>
        <label htmlFor="review-vault">État à observer</label>
        <NativeSelect
          id="review-vault"
          value={vault}
          onChange={(event) => setVault(event.target.value as KeyAvailability)}
        >
          <option value="missing">Clé absente</option>
          <option value="available">Disponible</option>
          <option value="locked">Verrouillé</option>
          <option value="unavailable">Indisponible</option>
          <option value="revoked">Révoqué</option>
        </NativeSelect>
        <DesktopVaultNotice state={vault} />
      </Section>
      <DesktopUpdateSurface
        state={{
          phase: "available",
          version: "0.1.0",
          message: "Une nouvelle version est disponible.",
          pendingLocalChanges: pending,
          migrationActive: false,
        }}
        busy={false}
        error={error}
        onCheck={() => setError(true)}
        onDefer={() => setError(false)}
        onInstall={() => setError(true)}
      />
      <Button variant="ghost" aria-pressed={pending} onClick={() => setPending(!pending)}>
        Modifications locales en attente
      </Button>
      <ConnectionStatus
        api={healthApi}
        hostLabel="notes.exemple.local"
        desktopStatus="incompatible"
      />
    </div>
  );
}

const backupStatus: FullBackupStatus = {
  lastVerifiedAt: "2026-10-03T02:00:00Z",
  lastVerifiedBackupId: reviewId(94),
  sourceVersion: "0.1.0",
  sourceVersionLabel: "V0 (0.1.0)",
  remote: "pending",
  remoteVerifiedAt: null,
  latestAttemptAt: "2026-10-03T02:00:00Z",
  latestAttemptOutcome: "failed",
  lastRehearsalAt: null,
  lastRehearsalOutcome: null,
  stale: false,
  rehearsalDue: true,
};
const loadBackup = async () => backupStatus;
const loadPortableBackup = async (): Promise<BackupStatus> => ({
  lastVerifiedAt: null,
  lastVerifiedBackupId: null,
  latestBackupAt: "2026-10-03T02:00:00Z",
  latestBackupId: reviewId(94),
  latestCreationVerification: "passed",
  latestTransferVerification: "failed",
  lastRehearsalAt: null,
  lastRehearsalOutcome: null,
  stale: true,
  rehearsalDue: true,
});
const failRehearsal = async () => {
  throw new Error("Exemple local sans restauration.");
};
export function ReviewBackup() {
  return (
    <div className="settings-content">
      <FullBackupPanel load={loadBackup} runRehearsal={failRehearsal} />
      <BackupPanel load={loadPortableBackup} runRehearsal={failRehearsal} />
    </div>
  );
}
