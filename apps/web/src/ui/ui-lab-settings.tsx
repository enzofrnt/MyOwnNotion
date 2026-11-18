import type { MeDto } from "@myownnotion/contracts";
import { useState } from "react";
import { FullBackupPanel } from "../features/backup/full-backup-panel.tsx";
import { SecuritySettings } from "../features/security/security-settings.tsx";
import { AccountSettings } from "../features/settings/account-settings.tsx";
import { AdministrationSettings } from "../features/settings/administration-settings.tsx";
import { type SettingsSection, SettingsShell } from "../features/settings/settings-shell.tsx";
import { WorkspaceManagementSettings } from "../features/settings/workspace-management-settings.tsx";
import { SecurityApi } from "../services/security-api.ts";

// Local preview of the settings shell with an in-memory account: no request
// leaves the page and no installation or profile is read.
class PreviewApi extends SecurityApi {
  override async updateMe(
    changes: Parameters<SecurityApi["updateMe"]>[0],
  ): ReturnType<SecurityApi["updateMe"]> {
    return { ok: true, value: { ...previewAccount, ...changes } as MeDto };
  }
  override async signOut(): ReturnType<SecurityApi["signOut"]> {
    return { ok: true, value: undefined } as Awaited<ReturnType<SecurityApi["signOut"]>>;
  }
}

const previewAccount = {
  id: "preview",
  pseudonym: "Camille Martin",
  email: "camille@example.org",
  role: "administrator",
} as unknown as MeDto;

const api = new PreviewApi("");

const trashed = [
  { id: "1", name: "Notes de réunion", kind: "page", purgeAfter: "2026-12-01T10:00:00Z" },
  { id: "2", name: "Archives 2025", kind: "folder", purgeAfter: null },
] as never;

export function UiLabSettingsPreview({
  section = "account",
}: {
  readonly section?: SettingsSection;
}) {
  const [account, setAccount] = useState<MeDto>(previewAccount);
  const none = () => undefined;
  return (
    <SettingsShell activeSection={section} administrator onBack={none} onSectionChange={none}>
      {section === "account" ? (
        <AccountSettings
          api={api}
          account={account}
          onAccountChange={setAccount}
          onSignedOut={none}
        />
      ) : section === "administration" ? (
        <AdministrationSettings api={api} currentAccountId="a1" />
      ) : section === "security" ? (
        <SecuritySettings
          api={api}
          administrator
          currentSessionId="s1"
          onReauthenticated={none}
          onSignedOut={none}
        />
      ) : section === "backups" ? (
        <FullBackupPanel
          load={async () =>
            ({
              stale: false,
              lastVerifiedAt: "2026-11-17T03:00:00Z",
              lastVerifiedBackupId: "b1",
              sourceVersionLabel: "1.8.2",
              latestAttemptOutcome: "succeeded",
              remote: "not-configured",
              remoteVerifiedAt: null,
              rehearsalDue: true,
              lastRehearsalAt: null,
              lastRehearsalOutcome: null,
            }) as never
          }
          runRehearsal={async () => undefined}
        />
      ) : (
        <WorkspaceManagementSettings
          activeItem={null}
          section={section as "trash"}
          service={{} as never}
          problem={null}
          trashedItems={trashed}
        />
      )}
    </SettingsShell>
  );
}
