import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation } from "@myownnotion/database";
import { documentDigestV3, type Uuid } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import type { PageCheckpointRetentionPolicy } from "../../src/page-state/checkpoint-service.ts";
import { hashPassword } from "../../src/security/password-service.ts";
import { loadSecurityConfig } from "../../src/security/security-config.ts";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  currentProtocolHeaders,
} from "./app.ts";

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";
export const PAGE_OPERATION_DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000cc" as Uuid;
const PASSWORD = "correct horse battery staple";

export interface AuthenticatedPageOperationHarness {
  readonly api: ApiHarness;
  reset(): Promise<void>;
  authenticate(): Promise<Record<string, string>>;
  createLegacyPage(name?: string): Promise<{
    readonly itemId: Uuid;
    readonly revisionId: Uuid;
    readonly canonicalDigest: string;
  }>;
  close(): Promise<void>;
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  return /mn_dev_session=([^;]*)/.exec(String(value ?? ""))?.[1] ?? "";
}

export async function createAuthenticatedPageOperationHarness(
  options: { readonly checkpointRetention?: PageCheckpointRetentionPolicy } = {},
): Promise<AuthenticatedPageOperationHarness> {
  const keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-operation-service-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), {
    encoding: "utf8",
    mode: 0o600,
  });
  const api = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
    ...(options.checkpointRetention === undefined
      ? {}
      : { pageCheckpointRetention: options.checkpointRetention }),
  });

  const reset = async () => {
    await api.built.database.db.execute(sql`
      TRUNCATE restoration_attempts, backup_verifications, backups,
        page_legacy_branch_conversions, page_ambiguities, page_device_frontiers,
        page_operation_updates, page_operation_checkpoints, page_operation_states,
        security_audit_events, security_rate_limits, recovery_kits, recovery_epochs,
        data_key_generations, sessions, authorized_devices, pending_bootstrap_credentials,
        bootstrap_attempts, password_credential_versions, passkey_credentials, owners,
        installations, protected_envelopes, changes, mutations, file_usages, logical_files,
        relationships, placements, revision_parents, page_documents, revisions, items CASCADE
    `);
    await createInstallation(api.built.database.db, {
      id: INSTALLATION_ID,
      sourceLineageId: INSTALLATION_ID,
      schemaVersion: 1,
    });
    await api.built.database.db.execute(sql`
      INSERT INTO owners (id, installation_id, state)
      VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')
    `);
    await api.built.database.db.execute(sql`
      UPDATE installations
         SET state = 'ready', owner_id = ${OWNER_ID}::uuid,
             workspace_id = ${api.built.context.workspaceId}::uuid
       WHERE id = ${INSTALLATION_ID}::uuid
    `);
    await api.built.database.db.execute(sql`
      INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
      VALUES (${PAGE_OPERATION_DEVICE_ID}::uuid, ${OWNER_ID}::uuid,
              'operation-service-device', 'Laptop', 'active')
    `);
    const password = await hashPassword(PASSWORD);
    await api.built.database.db.execute(sql`
      INSERT INTO password_credential_versions
        (id, owner_id, password_hash, hash_algorithm, state)
      VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${password.encoded}, 'scrypt', 'active')
    `);
  };

  return {
    api,
    reset,
    authenticate: async () => {
      const response = await api.built.app.inject({
        method: "POST",
        url: "/v1/auth/login/password",
        headers: currentProtocolHeaders(),
        payload: { password: PASSWORD },
      });
      if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
      return {
        ...currentProtocolHeaders(),
        cookie: `mn_dev_session=${cookieFrom(response)}`,
        "x-csrf-token": response.json().csrfToken as string,
      };
    },
    createLegacyPage: async (name = "Operational page") => {
      const page = await createItemViaApi(api, { kind: "page", name });
      return {
        itemId: page.itemId,
        revisionId: page.revisionId,
        canonicalDigest: await documentDigestV3({ blocks: [] }),
      };
    },
    close: async () => {
      await api.close();
      rmSync(keyDirectory, { recursive: true, force: true });
    },
  };
}
