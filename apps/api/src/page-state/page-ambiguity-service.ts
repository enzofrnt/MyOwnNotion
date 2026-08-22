/**
 * Durable ambiguities: detail and resolution (T143, FR-058, SC-018).
 *
 * A delete/edit or delete/move collision is never resolved silently. The
 * detection pass stores both intentions sealed; this service shows them and
 * turns the owner's decision into new operational commands through the same
 * transactional path as any other update. Source updates stay immutable —
 * resolving references them, it never rewrites them.
 */

import {
  type PageAmbiguityRow,
  readPageAmbiguityById,
  resolvePageAmbiguityRow,
  runMutation,
} from "@myownnotion/database";
import type { CanonicalBlockV3, Uuid } from "@myownnotion/domain";
import {
  type PageAmbiguity,
  planPageAmbiguityResolution,
  SemanticConflictError,
} from "@myownnotion/page-state";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import type { CanonicalMaterializer } from "./canonical-materializer.ts";
import type { PageOperationCrypto } from "./page-operation-crypto.ts";
import { PageOperationServiceError } from "./page-operation-errors.ts";
import type { PageOperationService } from "./page-operation-service.ts";

export interface PageAmbiguityDetail {
  readonly ambiguityId: Uuid;
  readonly pageId: Uuid;
  readonly kind: PageAmbiguityRow["kind"];
  readonly status: PageAmbiguityRow["status"];
  readonly openedAt: string;
  readonly blockIds: readonly Uuid[];
  readonly deletedSubtree: CanonicalBlockV3 | null;
  readonly recoverableSubtree: CanonicalBlockV3 | null;
  readonly recoverablePlacement: PageAmbiguity["recoverablePlacement"] | null;
  readonly propertyKey: string | null;
  readonly alternatives: readonly [CanonicalBlockV3, CanonicalBlockV3] | null;
}

export interface PageAmbiguityServiceDeps {
  readonly db: PageOperationServiceDepsDb;
  readonly workspaceId: Uuid;
  readonly crypto: PageOperationCrypto;
  readonly operations: PageOperationService;
  readonly materializer: CanonicalMaterializer;
  readonly rotationPolicies: RotationPolicyService;
  readonly now?: () => Date;
}

type PageOperationServiceDepsDb = ConstructorParameters<typeof PageOperationService>[0]["db"];

function parseDetails(bytes: Uint8Array): PageAmbiguity {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PageOperationServiceError(
      "page-operations.projection-invalid",
      "The stored ambiguity details are not valid JSON.",
      409,
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>)["logicalKey"] !== "string" ||
    !Array.isArray((value as Record<string, unknown>)["sourceUpdateIds"])
  ) {
    throw new PageOperationServiceError(
      "page-operations.projection-invalid",
      "The stored ambiguity details have an invalid shape.",
      409,
    );
  }
  return value as PageAmbiguity;
}

export class PageAmbiguityService {
  readonly #deps: Required<Pick<PageAmbiguityServiceDeps, "now">> & PageAmbiguityServiceDeps;

  constructor(deps: PageAmbiguityServiceDeps) {
    this.#deps = { ...deps, now: deps.now ?? (() => new Date()) };
  }

  async #load(tx: Parameters<PageOperationCrypto["openBytes"]>[0], ambiguityId: Uuid) {
    const row = await readPageAmbiguityById(tx, {
      workspaceId: this.#deps.workspaceId,
      ambiguityId,
    });
    if (row === null) {
      throw new PageOperationServiceError("ambiguity.not-found", "No such ambiguity.", 404);
    }
    const details = parseDetails(
      await this.#deps.crypto.openBytes(tx, "ambiguity", row.detailsEnvelopeId as Uuid),
    );
    return { row, details };
  }

  /** The full stored intentions for one ambiguity, decrypted on read. */
  async detail(input: { readonly ambiguityId: Uuid }): Promise<PageAmbiguityDetail> {
    return await runMutation(this.#deps.db, async (tx) => {
      const { row, details } = await this.#load(tx, input.ambiguityId);
      return {
        ambiguityId: row.id as Uuid,
        pageId: row.pageId as Uuid,
        kind: row.kind,
        status: row.status,
        openedAt: row.openedAt.toISOString(),
        blockIds: [...details.blockIds],
        deletedSubtree: details.deletedSubtree ?? null,
        recoverableSubtree: details.recoverableSubtree ?? null,
        recoverablePlacement: details.recoverablePlacement ?? null,
        propertyKey: details.propertyKey ?? null,
        alternatives:
          details.alternatives !== undefined
            ? [details.alternatives[0], details.alternatives[1]]
            : null,
      };
    });
  }

  /**
   * Applies the owner's decision as new operations and closes the ambiguity.
   *
   * `confirm-delete` keeps the deletion; `restore-change` recreates the
   * recovered subtree at an explicit placement; `custom` installs exactly the
   * supplied result. Every path produces a fresh revision and never touches
   * the source updates.
   */
  async resolve(input: {
    readonly ambiguityId: Uuid;
    readonly deviceId: Uuid;
    readonly request: {
      readonly requestId: Uuid;
      readonly decision: "confirm-delete" | "restore-change" | "custom";
      readonly parentBlockId?: Uuid | null;
      readonly beforeBlockId?: Uuid | null;
      readonly result?: CanonicalBlockV3;
    };
  }): Promise<{ revisionId: Uuid; status: string }> {
    try {
      return await runMutation(this.#deps.db, async (tx) => {
        const { row, details } = await this.#load(tx, input.ambiguityId);
        if (row.status !== "open") {
          throw new PageOperationServiceError(
            "ambiguity.already-resolved",
            "This ambiguity has already been resolved.",
            409,
          );
        }
        const decision = (() => {
          switch (input.request.decision) {
            case "confirm-delete":
              return { decision: "confirm-delete" } as const;
            case "restore-change":
              return {
                decision: "restore-change",
                parentBlockId: input.request.parentBlockId ?? null,
                beforeBlockId: input.request.beforeBlockId ?? null,
              } as const;
            case "custom":
              // The request contract requires `result` for custom decisions;
              // parseResolvePageAmbiguityRequest has rejected anything else.
              return {
                decision: "custom",
                result: input.request.result as CanonicalBlockV3,
                parentBlockId: input.request.parentBlockId ?? null,
                beforeBlockId: input.request.beforeBlockId ?? null,
              } as const;
          }
        })();
        const plan = planPageAmbiguityResolution(details, decision);
        const { revisionId } = await this.#deps.operations.applyServerCommands(
          {
            pageId: row.pageId as Uuid,
            deviceId: input.deviceId,
            mutationId: input.request.requestId,
            commands: plan.commands,
          },
          tx,
        );
        await resolvePageAmbiguityRow(tx, {
          workspaceId: this.#deps.workspaceId,
          ambiguityId: row.id as Uuid,
          status: plan.status,
          resolutionRevisionId: revisionId,
          resolvedAt: this.#deps.now(),
        });
        return { revisionId, status: plan.status };
      });
    } catch (error) {
      if (error instanceof SemanticConflictError) {
        throw new PageOperationServiceError("page-operations.validation", error.message, 409);
      }
      throw error;
    }
  }
}
