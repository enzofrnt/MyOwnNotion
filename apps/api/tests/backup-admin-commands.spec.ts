import type { Uuid } from "@myownnotion/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackupAdminCommandHandlers,
  BackupAdminContext,
} from "../src/admin/backup-admin-commands.ts";
import { runBackupAdminCommand } from "../src/admin/backup-admin-commands.ts";
import { EXIT_CODES } from "../src/admin/command-output.ts";
import { CommandUsageError, parseCommand } from "../src/admin/command-parser.ts";

const commandMocks = {
  runBackup: vi.fn(),
  verifyBackup: vi.fn(),
  restoreApply: vi.fn(),
  restoreTest: vi.fn(),
  versionInspect: vi.fn(),
};

const commandHandlers = commandMocks as unknown as BackupAdminCommandHandlers;

const success = { code: EXIT_CODES.ok, message: "ok" } as const;
const context: BackupAdminContext = {
  db: {} as never,
  databaseUrl: "postgres://example.test/myownnotion",
  workspaceId: "018f2b7c-0000-7000-8000-000000000001" as Uuid,
  service: {} as never,
  destination: { name: "filesystem" } as never,
  contentStore: {} as never,
  protectedContent: {} as never,
  open: async (bytes) => bytes,
  schemaVersion: 7,
  recordFormatVersion: 3,
  runningVersion: "sha-current",
  pendingMigrations: ["0007_next.sql"],
  terminalAvailable: true,
  confirmRestore: async () => true,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(commandMocks)) {
    mock.mockResolvedValue(success);
  }
});

describe("backup administration command routing", () => {
  it("routes backup creation through the shared command dependencies", async () => {
    expect(
      await runBackupAdminCommand(parseCommand(["backup", "run"]), context, commandHandlers),
    ).toBe(success);
    expect(commandMocks.runBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        db: context.db,
        workspaceId: context.workspaceId,
        service: context.service,
        destination: context.destination,
      }),
    );
  });

  it("supports both explicit and latest verification selectors", async () => {
    await runBackupAdminCommand(
      parseCommand(["backup", "verify", "--id", "backup-id"]),
      context,
      commandHandlers,
    );
    expect(commandMocks.verifyBackup).toHaveBeenLastCalledWith(expect.anything(), {
      id: "backup-id",
    });

    await runBackupAdminCommand(
      parseCommand(["backup", "verify", "--latest"]),
      context,
      commandHandlers,
    );
    expect(commandMocks.verifyBackup).toHaveBeenLastCalledWith(expect.anything(), {
      latest: true,
    });
  });

  it("routes a rehearsal with the database URL and installation versions", async () => {
    await runBackupAdminCommand(
      parseCommand(["restore", "test", "--latest"]),
      context,
      commandHandlers,
    );
    expect(commandMocks.restoreTest).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseUrl: context.databaseUrl,
        installation: { schemaVersion: 7, recordFormatVersion: 3 },
      }),
      { latest: true },
    );
  });

  it("routes destructive restoration flags and produces its safety backup", async () => {
    commandMocks.runBackup.mockResolvedValue({
      code: EXIT_CODES.ok,
      data: { backupId: "safety-backup" },
    });
    await runBackupAdminCommand(
      parseCommand(["restore", "apply", "--id", "backup-id", "--dry-run", "--yes"]),
      context,
      commandHandlers,
    );

    const [deps, options] = commandMocks.restoreApply.mock.calls[0] as [
      { safetyBackup: () => Promise<string | null> },
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      id: "backup-id",
      dryRun: true,
      yes: true,
      terminalAvailable: true,
    });
    expect(await deps.safetyBackup()).toBe("safety-backup");

    commandMocks.runBackup.mockResolvedValue({ code: EXIT_CODES.integrityFailure });
    expect(await deps.safetyBackup()).toBeNull();
  });

  it("routes version inspection with immutable build and migration context", async () => {
    await runBackupAdminCommand(parseCommand(["version", "inspect"]), context, commandHandlers);
    expect(commandMocks.versionInspect).toHaveBeenCalledWith({
      db: context.db,
      workspaceId: context.workspaceId,
      runningVersion: "sha-current",
      pendingMigrations: ["0007_next.sql"],
    });
  });

  it("refuses ambiguous, absent, malformed and unsupported selectors", async () => {
    await expect(
      runBackupAdminCommand(
        parseCommand(["backup", "verify", "--id", "one", "--latest"]),
        context,
        commandHandlers,
      ),
    ).rejects.toThrow(/either --id or --latest/);
    await expect(
      runBackupAdminCommand(parseCommand(["backup", "verify"]), context, commandHandlers),
    ).rejects.toThrow(/choose --id or --latest/);
    await expect(
      runBackupAdminCommand(
        { path: ["backup", "verify"], options: { id: true } },
        context,
        commandHandlers,
      ),
    ).rejects.toThrow(/--id requires a value/);
    await expect(
      runBackupAdminCommand(
        parseCommand(["restore", "apply", "--latest"]),
        context,
        commandHandlers,
      ),
    ).rejects.toThrow(/--id is required/);
    await expect(
      runBackupAdminCommand(parseCommand(["backup", "explode"]), context, commandHandlers),
    ).rejects.toThrow(CommandUsageError);
  });
});
