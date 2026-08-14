/**
 * Administrative recovery (T082, US6, FR-001, FR-019, FR-020, FR-024, SC-005).
 *
 * Restoring an installation onto a new machine. **Local only** — this service
 * is reachable from the protected CLI and from nowhere else, and that is
 * FR-019 rather than an omission: the operation adopts an installation's whole
 * identity, and putting it behind an HTTP route would mean a bearer token
 * standing between the network and someone else's workspace.
 *
 * Three properties define it, and each is the answer to a way it could destroy
 * data instead of restoring it.
 *
 * **It refuses a target that is not empty.** The dangerous failure is not "the
 * import did not work" but "the import worked, on top of an installation that
 * already held someone's notes". Emptiness is counted — owners, workspaces,
 * items, envelopes — rather than read off a status flag that a half-finished
 * earlier attempt would have set.
 *
 * **It adopts identifiers verbatim.** The installation id, the lineage, the
 * workspace, the owner. Regenerating any of them produces a machine holding
 * the same notes and denying it is the same installation — and feature-001's
 * canonical identity, which every revision and mutation is bound to, would
 * stop matching the data it describes.
 *
 * **It trusts no device.** The source's authorized devices are not imported. A
 * restore usually happens because something went wrong; re-authorizing a
 * device costs a minute, and the alternative is silently trusting hardware
 * nobody has looked at since.
 *
 * What it does *not* do is move data. The notes come from a database restore,
 * and this makes them readable again by adopting the identity they were
 * written under and installing the root key that opens them. An operator who
 * runs this against an empty database gets an empty, working installation —
 * which is the honest outcome, and why the command reports what it adopted.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "@myownnotion/database";
import {
  adoptSourceIdentity,
  RecoveryImportError,
  readTargetOccupancy,
  resetDeviceTrust,
  runSecurityTransaction,
  type TargetOccupancy,
  targetIsEmpty,
} from "@myownnotion/database";
import { openRecoveryKit, type RecoveryKit, seal } from "@myownnotion/domain/security";
// The wrap format and its AAD come from the hierarchy that will open the
// result. A local copy would be a second definition of the one string that
// decides whether a restored workspace is readable.
import { encodeWrapped, wrapAad } from "./key-hierarchy.ts";

export interface AdministrativeRecoveryDeps {
  readonly db: Database;
  /** The target's mounted deployment key. Also what opens the kit. */
  readonly deploymentKey: () => Buffer | null;
  readonly now: () => Date;
  readonly newId?: () => string;
}

export interface RecoveryImportResult {
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly workspaceId: string;
  readonly recoveryEpoch: number;
  readonly devicesRevoked: number;
  /** What the target held before the import. Zero everywhere, or it refused. */
  readonly occupancyBefore: TargetOccupancy;
}

export class AdministrativeRecoveryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AdministrativeRecoveryError";
    this.code = code;
  }
}

/**
 * What an inspection can say without changing anything.
 *
 * Its own type because the inspection is the thing an operator runs *first*,
 * usually while unsure, and it must be able to answer "would this work" with
 * no possibility of having done it.
 */
export interface CompatibilityReport {
  readonly kitOpens: boolean;
  readonly targetEmpty: boolean;
  readonly occupancy: TargetOccupancy;
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly supportedKeyGenerations: readonly number[];
  readonly blockers: readonly string[];
}

export class AdministrativeRecoveryService {
  readonly #deps: AdministrativeRecoveryDeps;

  constructor(deps: AdministrativeRecoveryDeps) {
    this.#deps = deps;
  }

  #id(): string {
    return (this.#deps.newId ?? (() => randomUUID()))();
  }

  /**
   * Answers whether an import would work, and changes nothing.
   *
   * Every blocker is collected rather than the first one returned. An operator
   * standing in front of a restored machine at three in the morning should
   * learn everything that is wrong in one command, not discover the second
   * problem after fixing the first.
   */
  async inspect(kit: RecoveryKit): Promise<CompatibilityReport> {
    const occupancy = await readTargetOccupancy(this.#deps.db);
    const empty = targetIsEmpty(occupancy);
    const blockers: string[] = [];

    const key = this.#deps.deploymentKey();
    if (key === null) {
      blockers.push("the target has no deployment key mounted");
    }

    let kitOpens = false;
    if (key !== null) {
      try {
        // `requireUsable: false` because an inspection is deliberately allowed
        // to look at a superseded kit. Refusing here would leave an operator
        // unable to find out whether an old kit is the one that matches, which
        // is exactly the question they have.
        openRecoveryKit(
          kit,
          { kind: "deployment-key", deploymentKey: new Uint8Array(key) },
          { requireUsable: false },
        );
        kitOpens = true;
      } catch {
        blockers.push(
          "the kit does not open with this deployment key; it belongs to another installation, or the wrong key is mounted",
        );
      }
    }

    if (!empty) {
      blockers.push(
        `the target is not empty (${occupancy.owners} owners, ${occupancy.items} items, ${occupancy.protectedEnvelopes} protected records)`,
      );
    }

    return {
      kitOpens,
      targetEmpty: empty,
      occupancy,
      installationId: kit.installationId,
      sourceLineageId: kit.sourceLineageId,
      supportedKeyGenerations: kit.supportedKeyGenerations,
      blockers,
    };
  }

  /**
   * Performs the import.
   *
   * Re-inspects first rather than trusting a report the caller may have
   * obtained minutes ago — the whole value of the emptiness rule is that it
   * holds at the moment of the write, and the repository checks it a third
   * time inside the transaction for the same reason.
   */
  async import(
    kit: RecoveryKit,
    options: { ownerId?: string } = {},
  ): Promise<RecoveryImportResult> {
    const key = this.#deps.deploymentKey();
    if (key === null) {
      throw new AdministrativeRecoveryError(
        "recovery_unavailable",
        "no deployment key is mounted; the kit cannot be opened",
      );
    }

    const report = await this.inspect(kit);
    if (report.blockers.length > 0) {
      throw new AdministrativeRecoveryError(
        report.targetEmpty ? "recovery_material_invalid" : "conflict",
        report.blockers.join("; "),
      );
    }

    let rootKey: Uint8Array;
    try {
      rootKey = openRecoveryKit(
        kit,
        { kind: "deployment-key", deploymentKey: new Uint8Array(key) },
        { requireUsable: false },
      );
    } catch {
      throw new AdministrativeRecoveryError(
        "recovery_material_invalid",
        "the kit could not be opened",
      );
    }

    const now = this.#deps.now();
    const ownerId = options.ownerId ?? this.#id();
    const wrappingKeyVersionId = this.#id();

    // Rewrapped for the target, under the target's own AAD. The root key bytes
    // are identical — that is what makes the restored data readable — but the
    // wrap binds installation, workspace, and version, so the row cannot be
    // lifted from one installation into another.
    const wrapped = seal(
      new Uint8Array(key),
      rootKey,
      wrapAad("root", kit.installationId, workspaceIdOf(kit), 1),
    );

    try {
      const devicesRevoked = await runSecurityTransaction(this.#deps.db, async (tx) => {
        await adoptSourceIdentity(tx, {
          installationId: kit.installationId,
          sourceLineageId: kit.sourceLineageId,
          workspaceId: workspaceIdOf(kit),
          workspaceSchemaVersion: 1,
          ownerId,
          wrappedRootKey: encodeWrapped(wrapped),
          rootKeyVersion: 1,
          wrappingKeyVersionId,
          wrappingKeyVersion: 1,
          now,
        });
        return await resetDeviceTrust(tx, kit.installationId);
      });

      return {
        installationId: kit.installationId,
        sourceLineageId: kit.sourceLineageId,
        workspaceId: workspaceIdOf(kit),
        recoveryEpoch: kit.recoveryEpoch,
        devicesRevoked,
        occupancyBefore: report.occupancy,
      };
    } catch (error) {
      if (error instanceof RecoveryImportError) {
        // The transaction's own emptiness check lost a race with something
        // that bootstrapped the target. Reported as a conflict rather than a
        // failure: nothing is wrong with the kit.
        throw new AdministrativeRecoveryError(error.code, error.message);
      }
      throw error;
    }
  }
}

/**
 * The workspace a kit belongs to.
 *
 * Derived from the lineage rather than carried separately, because
 * feature-001 gives an installation exactly one workspace and a kit that named
 * a different one would be describing an installation this application cannot
 * produce.
 */
function workspaceIdOf(kit: RecoveryKit): string {
  return kit.sourceLineageId;
}
