import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { installations, owners } from "./security/index.ts";

const utc = (name: string) => timestamp(name, { withTimezone: true });
export const mcpConnections = pgTable("mcp_connections", {
  id: uuid("id").primaryKey(),
  installationId: uuid("installation_id")
    .notNull()
    .references(() => installations.id),
  workspaceId: uuid("workspace_id").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => owners.id),
  authorizedByDeviceId: uuid("authorized_by_device_id").notNull(),
  scope: jsonb("scope").notNull(),
  accessHash: text("access_hash").unique(),
  createdAt: utc("created_at").notNull().defaultNow(),
  expiresAt: utc("expires_at"),
  revokedAt: utc("revoked_at"),
  lastUsedAt: utc("last_used_at"),
});
export const mcpExchangeTokens = pgTable("mcp_exchange_tokens", {
  id: uuid("id").primaryKey(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => mcpConnections.id, { onDelete: "cascade" }),
  secretHash: text("secret_hash").notNull().unique(),
  expiresAt: utc("expires_at").notNull(),
  consumedAt: utc("consumed_at"),
});
export const mcpMutations = pgTable("mcp_mutations", {
  mutationId: uuid("mutation_id").primaryKey(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => mcpConnections.id),
  action: text("action").notNull(),
  targetId: uuid("target_id").notNull(),
});
