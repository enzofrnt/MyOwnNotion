/**
 * Importing an installation into an empty target (T082, US6, FR-001, FR-019,
 * FR-020, FR-024, SC-005).
 *
 * Administrative recovery restores one installation's identity onto another
 * machine. That is a strictly more dangerous operation than anything else in
 * this package, because the failure mode is not "the import did not work" — it
 * is "the import worked, on top of an installation that already had someone's
 * notes in it".
 *
 * So the first function here is not the import. It is the refusal.
 *
 * **The target must be empty, and empty is checked, not assumed.** Not "the
 * installation row says uninitialized" — that is a claim a row makes about
 * itself, and a half-finished earlier import would make it while holding data.
 * The check counts owners, workspaces, items, and protected envelopes, and any
 * one of them being non-zero refuses.
 *
 * **The whole adoption is one transaction.** An installation that adopted a
 * lineage and then failed before its root key would be a machine claiming to
 * be an installation it cannot read — indistinguishable, from the outside,
 * from a corrupted original.
 *
 * **Device trust is not imported.** The source's authorized devices stay
 * behind. A restore usually happens because something went wrong, and
 * re-authorizing a device is a minute's work against the alternative of
 * silently trusting hardware nobody has looked at since.
 */

import { count, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { items, workspaces } from "../../schema/index.ts";
import {
  authorizedDevices,
  installations,
  owners,
  protectedEnvelopes,
  workspaceRootKeys,
  wrappingKeyVersions,
} from "../../schema/security/index.ts";

type Executor = Database | Transaction;

export class RecoveryImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoveryImportError";
    this.code = code;
  }
}

/** What stands in the way of an import, counted rather than inferred. */
export interface TargetOccupancy {
  readonly owners: number;
  readonly workspaces: number;
  readonly items: number;
  readonly protectedEnvelopes: number;
  readonly installations: number;
}

export function targetIsEmpty(occupancy: TargetOccupancy): boolean {
  return (
    occupancy.owners === 0 &&
    occupancy.workspaces === 0 &&
    occupancy.items === 0 &&
    occupancy.protectedEnvelopes === 0
  );
}

/**
 * Counts everything an import would overwrite.
 *
 * Four counts rather than one flag. An installation row saying `uninitialized`
 * is a claim the row makes about itself, and a half-finished earlier import
 * would make that claim while holding data. Counting what is actually there is
 * the only answer that cannot be stale.
 *
 * `installations` is reported but deliberately not part of `targetIsEmpty`: a
 * freshly started container writes its own uninitialized row before anyone
 * touches it, and refusing on that would make every real import impossible.
 */
export async function readTargetOccupancy(executor: Executor): Promise<TargetOccupancy> {
  const [ownerRow] = await executor.select({ value: count() }).from(owners);
  const [workspaceRow] = await executor.select({ value: count() }).from(workspaces);
  const [itemRow] = await executor.select({ value: count() }).from(items);
  const [envelopeRow] = await executor.select({ value: count() }).from(protectedEnvelopes);
  const [installationRow] = await executor.select({ value: count() }).from(installations);
  return {
    owners: ownerRow?.value ?? 0,
    workspaces: workspaceRow?.value ?? 0,
    items: itemRow?.value ?? 0,
    protectedEnvelopes: envelopeRow?.value ?? 0,
    installations: installationRow?.value ?? 0,
  };
}

export interface AdoptIdentityInput {
  /** The source installation's own id, adopted verbatim. */
  readonly installationId: string;
  /** The lineage the source belonged to. Never regenerated. */
  readonly sourceLineageId: string;
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  readonly ownerId: string;
  /** The workspace root key from the kit, rewrapped under the target's key. */
  readonly wrappedRootKey: string;
  readonly rootKeyVersion: number;
  readonly wrappingKeyVersionId: string;
  readonly wrappingKeyVersion: number;
  readonly now: Date;
}

/**
 * Adopts the source's identity, in one transaction.
 *
 * Every identifier is taken **verbatim**: the installation id, the lineage,
 * the workspace, the owner. Regenerating any of them would produce a machine
 * that holds the same notes and denies being the same installation — and
 * feature-001's canonical identity, which every revision and mutation is bound
 * to, would no longer match the data it describes.
 */
export async function adoptSourceIdentity(
  tx: Transaction,
  input: AdoptIdentityInput,
): Promise<void> {
  const occupancy = await readTargetOccupancy(tx);
  if (!targetIsEmpty(occupancy)) {
    // Checked again inside the transaction, not only by the caller. Between a
    // caller's check and this write, another process could have bootstrapped
    // the target — and the whole point of the refusal is that it holds under
    // exactly the conditions that make it hard to hold.
    throw new RecoveryImportError(
      "conflict",
      "the target is not empty; administrative recovery refuses to overwrite an installation",
    );
  }

  await tx
    .insert(workspaces)
    .values({
      id: input.workspaceId,
      schemaVersion: input.workspaceSchemaVersion,
      createdAt: input.now,
    })
    .onConflictDoNothing();

  // The installation row first, because `owners` references it — and
  // deliberately with neither owner nor workspace set. `installations_counts_check`
  // requires an uninitialized installation to have both null and a ready one to
  // have both set, so this is not a stylistic order: it is the only sequence
  // the schema permits, and the constraint is right to insist. A row that
  // claimed a workspace before it had an owner would be a half-promoted
  // installation, which is exactly the state the check exists to make
  // unpersistable.
  await tx
    .insert(installations)
    .values({
      id: input.installationId,
      sourceLineageId: input.sourceLineageId,
      state: "uninitialized",
      schemaVersion: input.workspaceSchemaVersion,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: installations.id,
      set: { sourceLineageId: input.sourceLineageId, updatedAt: input.now },
    });

  await tx.insert(owners).values({
    id: input.ownerId,
    installationId: input.installationId,
    state: "active",
    createdAt: input.now,
  });

  // Owner and workspace together with the state that requires them. The
  // check constraint accepts nothing else, and that is the schema saying the
  // same thing this comment does: there is no legal moment at which this
  // installation is half-adopted.
  await tx
    .update(installations)
    .set({
      state: "ready",
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      updatedAt: input.now,
    })
    .where(eq(installations.id, input.installationId));

  await tx
    .insert(wrappingKeyVersions)
    .values({
      id: input.wrappingKeyVersionId,
      installationId: input.installationId,
      version: input.wrappingKeyVersion,
      externalSecretReference: "mounted:deployment-key",
      algorithm: "AES-256-GCM",
      state: "current",
      createdAt: input.now,
    })
    .onConflictDoNothing();

  await tx.insert(workspaceRootKeys).values({
    id: crypto.randomUUID(),
    installationId: input.installationId,
    workspaceId: input.workspaceId,
    wrappingKeyVersionId: input.wrappingKeyVersionId,
    wrappedRootKey: input.wrappedRootKey,
    rootKeyVersion: input.rootKeyVersion,
    state: "active",
    createdAt: input.now,
  });
}

/**
 * Clears any device the target believed it had.
 *
 * Belt and braces on an empty target, and the point at which this becomes
 * load-bearing is a re-import after a partial one. A device row surviving into
 * a restored installation would be hardware nobody present has ever
 * authorized, holding a binding the new owner cannot revoke because they do
 * not know it exists.
 */
export async function resetDeviceTrust(tx: Transaction, installationId: string): Promise<number> {
  const rows = await tx
    .update(authorizedDevices)
    .set({ state: "revoked" })
    .where(eq(authorizedDevices.state, "active"))
    .returning({ id: authorizedDevices.id });
  void installationId;
  return rows.length;
}
