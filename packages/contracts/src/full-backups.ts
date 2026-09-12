import { type Static, Type } from "@sinclair/typebox";

const DateOrNull = Type.Union([Type.String({ format: "date-time" }), Type.Null()]);
const IdOrNull = Type.Union([Type.String({ format: "uuid" }), Type.Null()]);
const Outcome = Type.Union([
  Type.Literal("unfinished"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Null(),
]);
export const FullBackupStatusSchema = Type.Object(
  {
    lastVerifiedAt: DateOrNull,
    lastVerifiedBackupId: IdOrNull,
    sourceVersion: Type.Union([Type.String(), Type.Null()]),
    sourceVersionLabel: Type.String(),
    remote: Type.Union([
      Type.Literal("not-configured"),
      Type.Literal("pending"),
      Type.Literal("verified"),
      Type.Literal("failed"),
      Type.Null(),
    ]),
    remoteVerifiedAt: DateOrNull,
    latestAttemptAt: DateOrNull,
    latestAttemptOutcome: Outcome,
    lastRehearsalAt: DateOrNull,
    lastRehearsalOutcome: Outcome,
    stale: Type.Boolean(),
    rehearsalDue: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type FullBackupStatus = Static<typeof FullBackupStatusSchema>;

export const FullBackupRehearsalSchema = Type.Object(
  {
    backupId: Type.String({ format: "uuid" }),
    databaseRestored: Type.Literal(true),
    filesVerified: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type FullBackupRehearsal = Static<typeof FullBackupRehearsalSchema>;
