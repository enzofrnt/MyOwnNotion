/**
 * Executing a page ↔ folder conversion (T017, T025, US1, US2).
 *
 * One transaction, and the reason is not tidiness. Between changing the kind
 * and removing the document there is a state where an item is a folder that
 * still owns editorial content — a shape the model says cannot exist. Doing
 * both together means it never does, even if the process dies in between.
 *
 * **The protected envelope goes with the document.** Feature 002 seals the
 * body beside the row, so deleting one and keeping the other would leave
 * content the owner deliberately destroyed sitting on disk, encrypted, in a
 * place no screen shows and no owner would think to look. The revision
 * snapshot is the opposite case and must survive: it is what makes the
 * destruction undoable, it is visible in the history, and it expires on the
 * existing retention schedule.
 *
 * **Placements are not touched at all**, and there is no code here that could.
 * Since the schema denormalises whether an item is a *file* rather than which
 * kind it is, a page becoming a folder changes nothing a placement depends on.
 * That is what turns "every child is preserved" from a promise this function
 * keeps into a property of the schema.
 */

import type { ConvertItemCommand, DomainResult, Uuid } from "@myownnotion/domain";
import { generateUuidV7, planConversion } from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import type { Transaction } from "../../client.ts";
import { items, pageDocuments } from "../../schema/index.ts";
import { protectedEnvelopes } from "../../schema/security/index.ts";
import { getItem } from "../hierarchy-repository.ts";

/** The entity type feature 002 seals a page body under. */
const PAGE_BODY_ENTITY_TYPE = "page.body";

export interface ConvertItemResult {
  readonly revisionIds: Uuid[];
  readonly changedItemIds: Uuid[];
  readonly itemId: Uuid;
}

export async function executeConvertItem(
  tx: Transaction,
  input: {
    readonly command: ConvertItemCommand;
    readonly mutationId: Uuid;
    readonly acceptedAt: Date;
    readonly insertRevision: (revision: {
      id: Uuid;
      itemId: Uuid;
      mutationId: Uuid;
      parentRevisionIds: Uuid[];
      snapshot: Readonly<Record<string, unknown>>;
      acceptedAt: Date;
    }) => Promise<void>;
    readonly buildItemSnapshot: (itemId: Uuid) => Promise<Readonly<Record<string, unknown>>>;
    readonly supersedeRevision: (revisionId: Uuid, at: Date) => Promise<void>;
  },
): Promise<DomainResult<ConvertItemResult>> {
  const item = await getItem(tx, input.command.itemId);

  // Whether the page holds content lives in another table, so it is read here
  // and handed to the domain. The rule stays pure; only the lookup is here.
  const existing =
    item === null
      ? []
      : await tx
          .select({ pageId: pageDocuments.pageId })
          .from(pageDocuments)
          .where(eq(pageDocuments.pageId, item.id))
          .limit(1);
  const hasContent = existing.length > 0;

  const plan = planConversion(item, input.command, hasContent);
  if (!plan.ok) {
    return plan as DomainResult<ConvertItemResult>;
  }

  if (plan.value.noop) {
    // Already the target kind, so no new revision: a replay must be quiet, not
    // merely successful, and inventing a revision would put an event in the
    // history for something that did not happen.
    //
    // The item's *current* revision is returned as the result instead of an
    // empty list. That is not a workaround for the mutations_result_check
    // constraint — it is what the constraint is asking for, correctly
    // answered: the outcome of this mutation is the state the item is already
    // in, and that state has a revision.
    return {
      ok: true,
      value: {
        revisionIds: [plan.value.item.currentRevisionId],
        changedItemIds: [],
        itemId: plan.value.item.id,
      },
    };
  }

  const revisionId = generateUuidV7();

  await tx
    .update(items)
    .set({
      kind: plan.value.targetKind,
      currentRevisionId: revisionId,
      updatedAt: input.acceptedAt,
    })
    .where(eq(items.id, plan.value.item.id));

  if (plan.value.destroysContent) {
    await tx.delete(pageDocuments).where(eq(pageDocuments.pageId, plan.value.item.id));
    // Same transaction, deliberately: an envelope left behind is destroyed
    // content the owner cannot see, audit, or delete.
    await tx
      .delete(protectedEnvelopes)
      .where(
        and(
          eq(protectedEnvelopes.entityId, plan.value.item.id),
          eq(protectedEnvelopes.entityType, PAGE_BODY_ENTITY_TYPE),
        ),
      );
  }

  // The snapshot is taken *after* the change, as every other mutation does;
  // the previous state is reachable through the superseded revision, which is
  // what makes the destruction undoable.
  const snapshot = await input.buildItemSnapshot(plan.value.item.id);
  await input.insertRevision({
    id: revisionId,
    itemId: plan.value.item.id,
    mutationId: input.mutationId,
    parentRevisionIds: [plan.value.item.currentRevisionId],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await input.supersedeRevision(plan.value.item.currentRevisionId, input.acceptedAt);

  return {
    ok: true,
    value: {
      revisionIds: [revisionId],
      changedItemIds: [plan.value.item.id],
      itemId: plan.value.item.id,
    },
  };
}
