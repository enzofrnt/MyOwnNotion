import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { McpConnectionView, McpGrant, McpScope } from "@myownnotion/contracts";
import { type Database, runMutation, schema, type Transaction } from "@myownnotion/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AuditContext, AuditService } from "../security/audit-service.ts";
import type { ProtectedRecordService } from "../security/protected-record-service.ts";

export class McpAccessError extends Error {
  constructor(
    readonly code = "mcp.access-refused",
    readonly status = 403,
  ) {
    super("MCP access is unavailable or outside the authorized scope.");
  }
}
export function mcpSecretDigest(secret: string): string {
  return createHash("sha256").update("myownnotion.mcp.v1\0").update(secret).digest("hex");
}
export interface McpPrincipal {
  readonly connectionId: string;
  readonly ownerId: string;
  readonly deviceId: string;
  readonly scope: McpScope;
}
type Executor = Database | Transaction;
export class McpAccessService {
  constructor(
    readonly deps: {
      db: Database;
      installationId: string;
      workspaceId: string;
      records: ProtectedRecordService;
      audit: AuditService;
      now: () => Date;
      assertReady: (executor: Executor) => Promise<void>;
    },
  ) {}

  async assertReady(executor: Executor): Promise<void> {
    const [installation] = await executor
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.id, this.deps.installationId));
    if (installation?.state !== "ready" || installation.workspaceId !== this.deps.workspaceId)
      throw new McpAccessError("mcp.unavailable", 503);
    const [owner] = await executor
      .select()
      .from(schema.owners)
      .where(eq(schema.owners.id, installation.ownerId ?? "00000000-0000-0000-0000-000000000000"));
    if (owner?.state !== "active") throw new McpAccessError("mcp.unavailable", 503);
    await this.deps.assertReady(executor);
  }

  async grant(ownerId: string, deviceId: string, input: McpGrant, audit: AuditContext) {
    if (
      input.label.trim().length === 0 ||
      (!input.scope.allContent && input.scope.branchRootIds.length === 0) ||
      (input.scope.allContent && input.scope.branchRootIds.length > 0) ||
      (input.lifetimeDays === null && input.acknowledgeUnlimited !== true)
    )
      throw new McpAccessError("mcp.invalid-grant", 400);
    const id = randomUUID();
    const code = `mn_exchange_${randomBytes(32).toString("base64url")}`;
    const now = this.deps.now();
    const lifetime = input.lifetimeDays === undefined ? 90 : input.lifetimeDays;
    const expiresAt = lifetime === null ? null : new Date(now.getTime() + lifetime * 86_400_000);
    const exchangeExpiresAt = new Date(now.getTime() + 600_000);
    await runMutation(this.deps.db, async (tx) => {
      await this.assertReady(tx);
      for (const root of input.scope.branchRootIds) {
        const [item] = await tx
          .select()
          .from(schema.items)
          .where(
            and(
              eq(schema.items.id, root),
              eq(schema.items.workspaceId, this.deps.workspaceId),
              eq(schema.items.lifecycle, "active"),
            ),
          );
        if (item === undefined || item.kind === "file")
          throw new McpAccessError("mcp.invalid-grant", 400);
      }
      await tx.insert(schema.mcpConnections).values({
        id,
        ownerId,
        authorizedByDeviceId: deviceId,
        installationId: this.deps.installationId,
        workspaceId: this.deps.workspaceId,
        scope: input.scope,
        createdAt: now,
        expiresAt,
      });
      await this.deps.records.write(tx, {
        entityType: "mcp.label",
        entityId: id,
        recordVersion: 1,
        payload: new TextEncoder().encode(input.label.trim()),
      });
      await tx.insert(schema.mcpExchangeTokens).values({
        id: randomUUID(),
        connectionId: id,
        secretHash: mcpSecretDigest(code),
        expiresAt: exchangeExpiresAt,
      });
      await this.deps.audit.recordInTransaction(tx, audit, {
        eventType: "mcp.granted",
        outcome: "success",
        objectKind: "mcp-connection",
        objectId: id,
      });
    });
    return {
      connection: {
        id,
        label: input.label.trim(),
        scope: input.scope,
        createdAt: now.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
        lastUsedAt: null,
        status: "pending" as const,
      },
      exchangeCode: code,
      exchangeExpiresAt: exchangeExpiresAt.toISOString(),
    };
  }

  async exchange(code: string, correlationId: string) {
    const token = `mn_mcp_${randomBytes(32).toString("base64url")}`;
    return await runMutation(this.deps.db, async (tx) => {
      await this.assertReady(tx);
      const [exchange] = await tx
        .select()
        .from(schema.mcpExchangeTokens)
        .where(eq(schema.mcpExchangeTokens.secretHash, mcpSecretDigest(code)))
        .for("update");
      const now = this.deps.now();
      if (exchange === undefined || exchange.consumedAt !== null || exchange.expiresAt <= now)
        throw new McpAccessError("mcp.invalid-exchange", 401);
      const [connection] = await tx
        .select()
        .from(schema.mcpConnections)
        .where(eq(schema.mcpConnections.id, exchange.connectionId))
        .for("update");
      if (
        connection === undefined ||
        connection.revokedAt !== null ||
        (connection.expiresAt !== null && connection.expiresAt <= now)
      )
        throw new McpAccessError("mcp.invalid-exchange", 401);
      await this.assertDevice(tx, connection.authorizedByDeviceId);
      await tx
        .update(schema.mcpExchangeTokens)
        .set({ consumedAt: now })
        .where(eq(schema.mcpExchangeTokens.id, exchange.id));
      await tx
        .update(schema.mcpConnections)
        .set({ accessHash: mcpSecretDigest(token) })
        .where(eq(schema.mcpConnections.id, connection.id));
      await this.deps.audit.recordInTransaction(
        tx,
        this.auditContext(connection.id, correlationId),
        {
          eventType: "mcp.exchanged",
          outcome: "success",
          objectKind: "mcp-connection",
          objectId: connection.id,
        },
      );
      return {
        accessToken: token,
        tokenType: "Bearer",
        expiresAt: connection.expiresAt?.toISOString() ?? null,
      };
    });
  }

  async authenticate(secret: string): Promise<McpPrincipal> {
    await this.assertReady(this.deps.db);
    if (!/^mn_mcp_[A-Za-z0-9_-]{43}$/.test(secret))
      throw new McpAccessError("mcp.authentication-required", 401);
    const [row] = await this.deps.db
      .select()
      .from(schema.mcpConnections)
      .where(eq(schema.mcpConnections.accessHash, mcpSecretDigest(secret)));
    await this.assertDevice(this.deps.db, row?.authorizedByDeviceId);
    return this.principal(row);
  }
  private async assertDevice(executor: Executor, id: string | undefined): Promise<void> {
    if (id === undefined) throw new McpAccessError("mcp.authentication-required", 401);
    const [device] = await executor
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, id));
    if (device?.state !== "active") throw new McpAccessError("mcp.authentication-required", 401);
  }
  private principal(row: typeof schema.mcpConnections.$inferSelect | undefined): McpPrincipal {
    if (
      row === undefined ||
      row.workspaceId !== this.deps.workspaceId ||
      row.revokedAt !== null ||
      row.accessHash === null ||
      (row.expiresAt !== null && row.expiresAt <= this.deps.now())
    )
      throw new McpAccessError("mcp.authentication-required", 401);
    return {
      connectionId: row.id,
      ownerId: row.ownerId,
      deviceId: row.authorizedByDeviceId,
      scope: row.scope as McpScope,
    };
  }
  /** Locked authorization orders accepted writes and revocation. Never trust a cached principal. */
  async revalidate(tx: Transaction, principal: McpPrincipal): Promise<McpPrincipal> {
    await this.assertReady(tx);
    const [row] = await tx
      .select()
      .from(schema.mcpConnections)
      .where(eq(schema.mcpConnections.id, principal.connectionId))
      .for("update");
    await this.assertDevice(tx, row?.authorizedByDeviceId);
    return this.principal(row);
  }
  async inventory(ownerId: string): Promise<McpConnectionView[]> {
    const rows = await this.deps.db
      .select()
      .from(schema.mcpConnections)
      .where(eq(schema.mcpConnections.ownerId, ownerId))
      .orderBy(desc(schema.mcpConnections.createdAt));
    return Promise.all(
      rows.map(async (row) => {
        const label = await this.deps.records.read(this.deps.db, {
          entityType: "mcp.label",
          entityId: row.id,
        });
        if (label === null) throw new McpAccessError("mcp.unavailable", 503);
        const [exchange] = await this.deps.db
          .select()
          .from(schema.mcpExchangeTokens)
          .where(eq(schema.mcpExchangeTokens.connectionId, row.id));
        const [device] = await this.deps.db
          .select({ state: schema.authorizedDevices.state })
          .from(schema.authorizedDevices)
          .where(eq(schema.authorizedDevices.id, row.authorizedByDeviceId));
        return {
          id: row.id,
          label: new TextDecoder().decode(label),
          scope: row.scope as McpScope,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt?.toISOString() ?? null,
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
          status:
            row.revokedAt !== null || device?.state !== "active"
              ? ("revoked" as const)
              : (row.expiresAt !== null && row.expiresAt <= this.deps.now()) ||
                  (row.accessHash === null &&
                    (exchange === undefined || exchange.expiresAt <= this.deps.now()))
                ? ("expired" as const)
                : row.accessHash === null
                  ? ("pending" as const)
                  : ("active" as const),
        };
      }),
    );
  }
  async revoke(ownerId: string, id: string, audit: AuditContext): Promise<void> {
    await runMutation(this.deps.db, async (tx) => {
      const rows = await tx
        .update(schema.mcpConnections)
        .set({ revokedAt: this.deps.now() })
        .where(
          and(
            eq(schema.mcpConnections.id, id),
            eq(schema.mcpConnections.ownerId, ownerId),
            isNull(schema.mcpConnections.revokedAt),
          ),
        )
        .returning();
      if (rows.length > 0)
        await this.deps.audit.recordInTransaction(tx, audit, {
          eventType: "mcp.revoked",
          outcome: "success",
          objectKind: "mcp-connection",
          objectId: id,
        });
    });
  }
  auditContext(_connectionId: string, correlationId: string): AuditContext {
    return {
      installationId: this.deps.installationId,
      workspaceId: this.deps.workspaceId,
      correlationId,
      actorClass: "mcp",
    };
  }
  async recordOperation(
    tx: Transaction,
    principal: McpPrincipal,
    action: string,
    correlationId: string,
  ): Promise<void> {
    await tx
      .update(schema.mcpConnections)
      .set({ lastUsedAt: this.deps.now() })
      .where(eq(schema.mcpConnections.id, principal.connectionId));
    await this.deps.audit.recordInTransaction(
      tx,
      this.auditContext(principal.connectionId, correlationId),
      {
        eventType: "mcp.operation",
        outcome: "success",
        objectKind: action,
        objectId: principal.connectionId,
      },
    );
  }
}
