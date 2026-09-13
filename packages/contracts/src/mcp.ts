import { type Static, Type } from "@sinclair/typebox";

export const MCP_ACTIONS = ["search", "read", "create", "edit", "delete"] as const;
export type McpAction = (typeof MCP_ACTIONS)[number];
export const McpScopeSchema = Type.Object(
  {
    actions: Type.Array(Type.Union(MCP_ACTIONS.map((action) => Type.Literal(action))), {
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
    }),
    // An empty array is valid only with explicit whole-workspace authorization.
    allContent: Type.Boolean(),
    branchRootIds: Type.Array(Type.String({ format: "uuid" }), {
      maxItems: 100,
      uniqueItems: true,
    }),
    files: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type McpScope = Static<typeof McpScopeSchema>;
export const McpGrantSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 120 }),
    scope: McpScopeSchema,
    lifetimeDays: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 90 }), Type.Null()]),
    ),
    acknowledgeUnlimited: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type McpGrant = Static<typeof McpGrantSchema>;
export interface McpConnectionView {
  id: string;
  label: string;
  scope: McpScope;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  status: "pending" | "active" | "expired" | "revoked";
}
export interface McpGrantResult {
  connection: McpConnectionView;
  exchangeCode: string;
  exchangeExpiresAt: string;
}
