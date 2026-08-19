import type { Uuid } from "@myownnotion/domain";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BackupRouteDeps, registerBackupRoutes } from "../src/routes/backups.ts";

const repositoryMocks = vi.hoisted(() => ({
  lastVerified: vi.fn(),
  latest: vi.fn(),
  lastRehearsal: vi.fn(),
}));

vi.mock("@myownnotion/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@myownnotion/database")>()),
  lastVerifiedBackupAtDestination: repositoryMocks.lastVerified,
  latestBackupVerificationStatus: repositoryMocks.latest,
  lastTestRestoration: repositoryMocks.lastRehearsal,
}));

const NOW = new Date("2026-08-19T12:00:00.000Z");
const owner = {
  kind: "owner" as const,
  ownerId: "owner",
  sessionId: "session",
  deviceId: "device",
  recentAuthAt: NOW,
};

let apps: FastifyInstance[] = [];

async function appFor(overrides: Partial<BackupRouteDeps> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerBackupRoutes(app, {
    db: {} as never,
    workspaceId: "018f2b7c-0000-7000-8000-000000000001" as Uuid,
    now: () => NOW,
    require: () => owner,
    ...overrides,
  });
  await app.ready();
  return app;
}

beforeEach(() => {
  repositoryMocks.lastVerified.mockReset().mockResolvedValue(null);
  repositoryMocks.latest.mockReset().mockResolvedValue(null);
  repositoryMocks.lastRehearsal.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  await Promise.all(apps.map(async (app) => await app.close()));
  apps = [];
});

describe("owner backup status", () => {
  it("reports a missing backup and rehearsal as stale and due", async () => {
    const response = await (await appFor()).inject({ method: "GET", url: "/v1/backups/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      lastVerifiedAt: null,
      lastVerifiedBackupId: null,
      latestBackupAt: null,
      latestBackupId: null,
      latestCreationVerification: null,
      latestTransferVerification: null,
      lastRehearsalAt: null,
      lastRehearsalOutcome: null,
      stale: true,
      rehearsalDue: true,
    });
  });

  it("reports recent recorded evidence without leaking destination metadata", async () => {
    repositoryMocks.lastVerified.mockResolvedValue({
      backupId: "018f2b7c-0000-7000-8000-0000000000aa",
      checkedAt: new Date("2026-08-19T10:00:00.000Z"),
    });
    repositoryMocks.lastRehearsal.mockResolvedValue({
      startedAt: new Date("2026-08-18T10:00:00.000Z"),
      outcome: "succeeded",
    });
    repositoryMocks.latest.mockResolvedValue({
      backupId: "018f2b7c-0000-7000-8000-0000000000bb",
      createdAt: new Date("2026-08-19T11:00:00.000Z"),
      afterCreation: "passed",
      afterTransfer: "failed",
    });
    const response = await (await appFor()).inject({ method: "GET", url: "/v1/backups/status" });
    expect(response.json()).toMatchObject({
      lastVerifiedAt: "2026-08-19T10:00:00.000Z",
      lastVerifiedBackupId: "018f2b7c-0000-7000-8000-0000000000aa",
      latestBackupAt: "2026-08-19T11:00:00.000Z",
      latestBackupId: "018f2b7c-0000-7000-8000-0000000000bb",
      latestCreationVerification: "passed",
      latestTransferVerification: "failed",
      lastRehearsalAt: "2026-08-18T10:00:00.000Z",
      lastRehearsalOutcome: "succeeded",
      stale: false,
      rehearsalDue: false,
    });
    expect(response.body).not.toMatch(/destination|digest|remote/i);
  });

  it("stops when the owner gate has already refused the request", async () => {
    const response = await (
      await appFor({
        require: (_request, reply: FastifyReply) => {
          void reply.status(401).send({ refused: true });
          return null;
        },
      })
    ).inject({ method: "GET", url: "/v1/backups/status" });
    expect(response.statusCode).toBe(401);
    expect(repositoryMocks.lastVerified).not.toHaveBeenCalled();
  });
});

describe("owner-requested restore rehearsals", () => {
  it("returns the isolated restoration counts", async () => {
    const response = await (
      await appFor({
        runRehearsal: async () => ({
          code: 0,
          data: { restoredItemCount: 4, restoredFileCount: 2 },
        }),
      })
    ).inject({ method: "POST", url: "/v1/backups/rehearsals" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      outcome: "succeeded",
      restoredItemCount: 4,
      restoredFileCount: 2,
    });
  });

  it("fails closed when the host rehearsal is unavailable", async () => {
    const response = await (await appFor()).inject({
      method: "POST",
      url: "/v1/backups/rehearsals",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe("internal_error");
  });

  it.each([
    [3, 409, "conflict"],
    [7, 500, "internal_error"],
  ])("maps command exit code %s to a safe problem", async (code, status, problemCode) => {
    const response = await (
      await appFor({ runRehearsal: async () => ({ code: code as 3 | 7 }) })
    ).inject({ method: "POST", url: "/v1/backups/rehearsals" });
    expect(response.statusCode).toBe(status);
    expect(response.json().code).toBe(problemCode);
  });
});
