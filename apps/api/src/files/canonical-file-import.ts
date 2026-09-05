import {
  DomainRejection,
  executeImportFile,
  recordChange,
  schema,
  type Transaction,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import type { AppContext } from "../context.ts";
import { acceptedWriteGuards } from "../plugins/mutations.ts";

/** Logical publication shared by resumable uploads and protected local imports. */
export async function publishCanonicalFile(
  tx: Transaction,
  context: Pick<AppContext, "workspaceId" | "protectedContent" | "rotationPolicies">,
  input: Omit<Parameters<typeof executeImportFile>[1], "workspaceId"> & {
    attribution?: { mutationId: Uuid; deviceId: string } | undefined;
  },
) {
  const execution = await executeImportFile(tx, { ...input, workspaceId: context.workspaceId });
  if (!execution.ok) throw new DomainRejection(execution.error);
  await acceptedWriteGuards(
    { type: "file.import" },
    context.protectedContent,
    context.rotationPolicies,
    input.attribution,
  ).onAccepted?.(tx, {
    primaryItemId: input.itemId,
    revisionIds: [execution.value.revisionId],
  });
  await tx.insert(schema.mutations).values({
    id: input.mutationId,
    workspaceId: context.workspaceId,
    commandType: "file.import",
    status: "accepted",
    submittedAt: input.acceptedAt,
    acceptedAt: input.acceptedAt,
    resultRevisionIds: [execution.value.revisionId],
  });
  const committedSequence = await recordChange(tx, {
    workspaceId: context.workspaceId,
    mutationId: input.mutationId,
    revisionIds: [execution.value.revisionId],
    changedItemIds: [input.itemId],
  });
  return { ...execution.value, committedSequence };
}
