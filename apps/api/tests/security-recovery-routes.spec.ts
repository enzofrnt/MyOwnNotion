import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RecoveryRouteDeps, registerRecoveryRoutes } from "../src/routes/security-recovery.ts";
import type { AuditService } from "../src/security/audit-service.ts";
import { RecoveryKitError, type RecoveryKitService } from "../src/security/recovery-kit-service.ts";

const OWNER = {
  kind: "owner" as const,
  ownerId: "owner-1",
  sessionId: "session-1",
  deviceId: "device-1",
  recentAuthAt: new Date("2026-09-13T09:00:00.000Z"),
};

const NOTICE = "Keep the deployment key with this file.";
const KIT_ID = "018f2b7c-0000-7000-8000-000000000002";
const ACTIVE_KIT_ID = "018f2b7c-0000-7000-8000-000000000003";
const ARTIFACT = {
  format: "myownnotion.recovery+json",
  formatVersion: 1,
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  sourceLineageId: "018f2b7c-0000-7000-8000-000000000001",
  kitId: KIT_ID,
  recoveryEpoch: 2,
  authorizationState: "provisional",
  deliveryState: "download-consumed",
  createdAt: "2026-09-13T09:00:00.000Z",
  downloadExpiresAt: "2026-09-13T09:15:00.000Z",
  downloadConsumedAt: "2026-09-13T09:01:00.000Z",
  supportedKeyGenerations: [1],
  kdf: {
    algorithm: "scrypt",
    N: 8192,
    r: 8,
    p: 1,
    keyLength: 32,
    salt: "AAAAAAAAAAAAAAAAAAAAAA",
  },
  encryption: {
    algorithm: "AES-256-GCM",
    nonce: "AAAAAAAAAAAAAAAA",
    ciphertext: "AQ",
    tag: "AAAAAAAAAAAAAAAAAAAAAA",
  },
} as const;
const prepared = {
  kitId: KIT_ID,
  recoveryEpoch: 2,
  downloadExpiresAt: "2026-09-13T09:15:00.000Z",
  notice: NOTICE,
};

type RouteHarness = {
  app: FastifyInstance;
  kits: {
    status: ReturnType<typeof vi.fn>;
    prepareReplacement: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  audit: { record: ReturnType<typeof vi.fn> };
  require: ReturnType<typeof vi.fn>;
};

const apps: FastifyInstance[] = [];

async function appFor(
  options: {
    readonly requireOwner?: RecoveryRouteDeps["require"];
    readonly kits?: Partial<RouteHarness["kits"]>;
  } = {},
): Promise<RouteHarness> {
  const kits = {
    status: vi.fn().mockResolvedValue({
      active: {
        kitId: ACTIVE_KIT_ID,
        recoveryEpoch: 1,
        confirmedAt: "2026-09-12T09:00:00.000Z",
      },
      pending: null,
      notice: NOTICE,
    }),
    prepareReplacement: vi.fn().mockResolvedValue(prepared),
    download: vi.fn().mockResolvedValue(ARTIFACT),
    confirm: vi.fn().mockResolvedValue({ recoveryEpoch: 2, notice: NOTICE }),
    revoke: vi.fn().mockResolvedValue({ revocationCode: "revoke-123" }),
    ...options.kits,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const require = vi.fn(options.requireOwner ?? (() => OWNER));
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, request, reply) => {
    if ((error as { validation?: unknown }).validation !== undefined) {
      return reply.status(400).send({
        type: "https://myownnotion.dev/problems/validation.invalid-payload",
        title: "Request does not match the API contract",
        status: 400,
        code: "validation.invalid-payload",
        correlationId: "018f2b7c-0000-7000-8000-000000000099",
      });
    }
    request.log.error({ err: error }, "unexpected test-harness error");
    return reply.status(500).send({
      type: "https://myownnotion.dev/problems/internal_error",
      title: "Unexpected server error",
      status: 500,
      code: "internal_error",
      correlationId: "018f2b7c-0000-7000-8000-000000000099",
    });
  });
  apps.push(app);
  registerRecoveryRoutes(app, {
    kits: kits as unknown as RecoveryKitService,
    audit: audit as unknown as AuditService,
    installationId: "installation-1",
    require,
  });
  await app.ready();
  return { app, kits, audit, require };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.close()));
});

describe("owner recovery routes", () => {
  it("requires the owner gate for every operation and passes the right freshness requirements", async () => {
    const refusal = {
      type: "https://myownnotion.dev/problems/authentication_required",
      title: "Authentication required",
      status: 401,
      code: "authentication_required",
      correlationId: "018f2b7c-0000-7000-8000-000000000001",
    };
    const requireOwner = vi.fn((_request: FastifyRequest, reply: FastifyReply) => {
      void reply.status(401).send(refusal);
      return null;
    });
    const route = await appFor({ requireOwner });
    const requests = [
      { method: "GET" as const, url: "/v1/security/recovery-kits" },
      { method: "POST" as const, url: "/v1/security/recovery-kits" },
      { method: "POST" as const, url: `/v1/security/recovery-kits/${KIT_ID}/download` },
      {
        method: "POST" as const,
        url: `/v1/security/recovery-kits/${KIT_ID}/confirm`,
        payload: { storedOffline: true },
      },
      { method: "POST" as const, url: "/v1/security/recovery-kits/revoke" },
    ];

    for (const request of requests) {
      const response = await route.app.inject(request);
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("authentication_required");
    }

    expect(requireOwner).toHaveBeenCalledTimes(requests.length);
    expect(requireOwner.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      {},
      { csrf: true, recentAuthentication: true },
      { csrf: true, recentAuthentication: true },
      { csrf: true, recentAuthentication: true },
      { csrf: true, recentAuthentication: true },
    ]);
  });

  it("returns the status snapshot without asking for recent authentication", async () => {
    const route = await appFor();
    const response = await route.app.inject({ method: "GET", url: "/v1/security/recovery-kits" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({
      active: {
        kitId: ACTIVE_KIT_ID,
        recoveryEpoch: 1,
        confirmedAt: "2026-09-12T09:00:00.000Z",
      },
      pending: null,
      notice: NOTICE,
    });
    expect(route.kits.status).toHaveBeenCalledOnce();
    expect(route.require).toHaveBeenCalledWith(expect.anything(), expect.anything(), {});
  });

  it("prepares a replacement and records the kit id and epoch", async () => {
    const route = await appFor();
    const response = await route.app.inject({ method: "POST", url: "/v1/security/recovery-kits" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(prepared);
    expect(route.kits.prepareReplacement).toHaveBeenCalledOnce();
    expect(route.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: "installation-1", actorClass: "owner" }),
      {
        eventType: "recovery.kit-prepared",
        outcome: "success",
        objectKind: "recovery-kit",
        objectId: prepared.kitId,
        metadata: { recoveryEpoch: prepared.recoveryEpoch },
      },
    );
  });

  it("downloads the artifact as a no-store attachment and audits consumption", async () => {
    const artifact = ARTIFACT;
    const route = await appFor({ kits: { download: vi.fn().mockResolvedValue(artifact) } });
    const response = await route.app.inject({
      method: "POST",
      url: `/v1/security/recovery-kits/${KIT_ID}/download`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(artifact);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="myownnotion-recovery.json"',
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(route.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "recovery.kit-download-consumed",
        objectId: KIT_ID,
      }),
    );
  });

  it("confirms a downloaded kit and records both security facts", async () => {
    const route = await appFor();
    const response = await route.app.inject({
      method: "POST",
      url: `/v1/security/recovery-kits/${KIT_ID}/confirm`,
      payload: { storedOffline: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ recoveryEpoch: 2, notice: NOTICE });
    expect(route.kits.confirm).toHaveBeenCalledWith(KIT_ID);
    expect(route.audit.record).toHaveBeenCalledTimes(2);
    expect(route.audit.record).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        eventType: "recovery.kit-confirmed",
        objectId: KIT_ID,
        metadata: { recoveryEpoch: 2 },
      }),
    );
    expect(route.audit.record).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ eventType: "recovery.epoch-advanced", objectId: "2" }),
    );
  });

  it.each([
    ["missing body", undefined],
    ["false confirmation", { storedOffline: false }],
    ["extra field", { storedOffline: true, confirmedBy: "owner" }],
  ])("rejects %s before calling the confirmation service", async (_label, payload) => {
    const route = await appFor();
    const response = await route.app.inject({
      method: "POST",
      url: `/v1/security/recovery-kits/${KIT_ID}/confirm`,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation.invalid-payload", status: 400 });
    expect(route.kits.confirm).not.toHaveBeenCalled();
  });

  it("revokes the active kit and audits the owner-facing revocation code", async () => {
    const route = await appFor();
    const response = await route.app.inject({
      method: "POST",
      url: "/v1/security/recovery-kits/revoke",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revocationCode: "revoke-123" });
    expect(route.kits.revoke).toHaveBeenCalledOnce();
    expect(route.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "recovery.kit-revoked",
        objectId: "revoke-123",
      }),
    );
  });

  it("does not register the singular legacy route and prepares without a request body", async () => {
    const route = await appFor();
    const legacy = await route.app.inject({ method: "GET", url: "/v1/security/recovery" });
    expect(legacy.statusCode).toBe(404);

    const prepared = await route.app.inject({ method: "POST", url: "/v1/security/recovery-kits" });
    // The handler has no request body contract: the deployment key is the
    // only wrapping authority, and no passphrase is required.
    expect(prepared.statusCode).toBe(201);
    expect(route.kits.prepareReplacement).toHaveBeenCalledOnce();
  });
});

describe("safe recovery refusals", () => {
  it("maps a known service code and records the refusal", async () => {
    const route = await appFor({
      kits: {
        prepareReplacement: vi
          .fn()
          .mockRejectedValue(new RecoveryKitError("recovery_unavailable", "private key detail")),
      },
    });
    const response = await route.app.inject({ method: "POST", url: "/v1/security/recovery-kits" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "recovery_unavailable", status: 409 });
    expect(response.body).not.toContain("private key detail");
    expect(route.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "recovery.kit-rejected",
        outcome: "refused",
        objectKind: "recovery-kit",
      }),
    );
  });

  it("collapses an unknown download error to internal_error", async () => {
    const route = await appFor({
      kits: { download: vi.fn().mockRejectedValue(new Error("database path and secret")) },
    });
    const response = await route.app.inject({
      method: "POST",
      url: `/v1/security/recovery-kits/${KIT_ID}/download`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: "internal_error", status: 500 });
    expect(response.body).not.toContain("database path and secret");
    expect(route.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "recovery.kit-rejected", outcome: "refused" }),
    );
  });

  it.each([
    ["confirm", `/v1/security/recovery-kits/${KIT_ID}/confirm`],
    ["revoke", "/v1/security/recovery-kits/revoke"],
  ])("returns a safe refusal when %s cannot complete", async (operation, url) => {
    const kits =
      operation === "confirm"
        ? { confirm: vi.fn().mockRejectedValue(new Error("operator-only detail")) }
        : { revoke: vi.fn().mockRejectedValue(new RecoveryKitError("conflict", "private state")) };
    const route = await appFor({ kits });
    const response = await route.app.inject({
      method: "POST",
      url,
      ...(operation === "confirm" ? { payload: { storedOffline: true } } : {}),
    });

    expect(response.statusCode).toBe(operation === "confirm" ? 500 : 409);
    expect(response.json()).toMatchObject({
      code: operation === "confirm" ? "internal_error" : "conflict",
    });
    expect(response.body).not.toMatch(/operator-only detail|private state/);
    expect(route.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "recovery.kit-rejected", outcome: "refused" }),
    );
  });

  it("does not report a repeated confirmation as a successful epoch advance", async () => {
    const route = await appFor({
      kits: {
        confirm: vi
          .fn()
          .mockRejectedValue(new RecoveryKitError("conflict", "the kit is already active")),
      },
    });
    const response = await route.app.inject({
      method: "POST",
      url: `/v1/security/recovery-kits/${KIT_ID}/confirm`,
      payload: { storedOffline: true },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "conflict", status: 409 });
    expect(route.audit.record).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "recovery.kit-confirmed" }),
    );
    expect(route.audit.record).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "recovery.epoch-advanced" }),
    );
  });
});
