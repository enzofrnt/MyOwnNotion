import { readFile, stat } from "node:fs/promises";
import process from "node:process";
import { isUuid } from "@myownnotion/domain";
import { fullBackupRoot } from "../../backup/backup-config.ts";
import { NotionApiClient } from "./api-client.ts";
import { applyNotionImport, loadNotionImportPlan } from "./apply.ts";
import { collectNotion, discoveryReport } from "./collect.ts";
import { planNotionImport } from "./plan.ts";
import { NotionImportError } from "./source.ts";
import { openNotionTarget } from "./target.ts";

export const NOTION_IMPORT_HELP = `Notion API import — preview first

  --discover [--json]
  --root UUID [--root UUID ...] | --all [--exclude-database UUID ...] [--id UUID] [--json] [--dry-run] [--apply]
  --resume --id UUID [--json] [--dry-run]

Secret: NOTION_TOKEN or NOTION_TOKEN_FILE (private file); never a CLI argument.
Preview opens no target. --dry-run overrides --apply. Apply requires an explicit
UUID and DATABASE_URL, MYOWNNOTION_BLOB_ROOT, MYOWNNOTION_BACKUP_ROOT,
MYOWNNOTION_DEPLOYMENT_KEY_FILE. A verified full backup precedes every new import.
Resume reads the encrypted saved snapshot without contacting Notion.
--json is a detailed private report; ordinary output uses counts and safe codes.
File/ZIP/Obsidian import (--source) has been removed.`;
export interface NotionCliDependencies {
  client?: (token: string, signal?: AbortSignal | undefined) => NotionApiClient;
  signal?: AbortSignal | undefined;
  progress?: (message: string) => void;
}
export async function runNotionImportCli(
  argv: readonly string[],
  print: (line: string) => void,
  env: Record<string, string | undefined> = process.env,
  dependencies: NotionCliDependencies = {},
): Promise<number> {
  if (!argv.length || argv.includes("--help")) {
    print(NOTION_IMPORT_HELP);
    return 0;
  }
  let target: Awaited<ReturnType<typeof openNotionTarget>> | undefined;
  let json = false;
  try {
    const options: Record<string, string | boolean> = {},
      roots: string[] = [],
      excludedDatabaseIds: string[] = [];
    for (let index = 0; index < argv.length; index++) {
      const option = argv[index];
      if (
        !option ||
        ![
          "--discover",
          "--root",
          "--exclude-database",
          "--all",
          "--id",
          "--json",
          "--apply",
          "--dry-run",
          "--resume",
        ].includes(option) ||
        (!["--root", "--exclude-database"].includes(option) && options[option] !== undefined)
      )
        throw new NotionImportError("import.invalid-arguments");
      if (option === "--root" || option === "--id" || option === "--exclude-database") {
        const value = argv[++index];
        if (!value || !isUuid(value)) throw new NotionImportError("import.invalid-arguments");
        if (option === "--exclude-database") excludedDatabaseIds.push(value);
        else if (option === "--root") roots.push(value);
        else options[option] = value;
      } else options[option] = true;
    }
    json = options["--json"] === true;
    const resume = options["--resume"] === true,
      discover = options["--discover"] === true,
      all = options["--all"] === true;
    const apply = (options["--apply"] === true || resume) && options["--dry-run"] !== true;
    const id = options["--id"];
    if (
      ((resume || discover) && excludedDatabaseIds.length > 0) ||
      (all && roots.length) ||
      (resume && (all || roots.length || discover)) ||
      (discover && (all || roots.length || apply || resume)) ||
      (!discover && !resume && !all && !roots.length) ||
      ((apply || resume) && !isUuid(id))
    )
      throw new NotionImportError("import.invalid-arguments");
    const openTarget = async () => {
      const connectionString = env["DATABASE_URL"],
        blobRoot = env["MYOWNNOTION_BLOB_ROOT"],
        keyFile = env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"],
        backupRoot = env["MYOWNNOTION_BACKUP_ROOT"];
      if (!connectionString || !blobRoot || !keyFile || !backupRoot)
        throw new NotionImportError("import.target-configuration-required");
      return openNotionTarget({
        connectionString,
        blobRoot,
        keyFile,
        backupRoot: fullBackupRoot({ root: backupRoot }),
        ...(env["MYOWNNOTION_MIGRATIONS_DIR"]
          ? { migrationsDir: env["MYOWNNOTION_MIGRATIONS_DIR"] }
          : {}),
      });
    };
    if (
      apply &&
      !resume &&
      (!env["DATABASE_URL"] ||
        !env["MYOWNNOTION_BLOB_ROOT"] ||
        !env["MYOWNNOTION_BACKUP_ROOT"] ||
        !env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"])
    )
      throw new NotionImportError("import.target-configuration-required");
    let plan: ReturnType<typeof planNotionImport>;
    if (resume && isUuid(id)) {
      target = await openTarget();
      plan = await loadNotionImportPlan(target, id);
    } else {
      let token = env["NOTION_TOKEN"]?.trim();
      if (!token && env["NOTION_TOKEN_FILE"]) {
        const path = env["NOTION_TOKEN_FILE"],
          info = await stat(path);
        if (
          !info.isFile() ||
          info.size > 4096 ||
          (process.platform !== "win32" && (info.mode & 0o077) !== 0)
        )
          throw new NotionImportError("import.token-file-not-private");
        token = (await readFile(path, "utf8")).trim();
      }
      if (!token) throw new NotionImportError("import.token-required");
      const client =
        dependencies.client?.(token, dependencies.signal) ??
        new NotionApiClient(token, { signal: dependencies.signal });
      if (discover) {
        const report = discoveryReport(await client.discover());
        print(
          json
            ? JSON.stringify({ objects: report })
            : `${report.length} accessible objects. Use --discover --json for private titles and IDs; select --root UUID or --all.`,
        );
        return 0;
      }
      dependencies.progress?.("Reading Notion; no canonical content has been applied yet.");
      plan = planNotionImport(
        await collectNotion(client, {
          roots,
          all,
          signal: dependencies.signal,
          onProgress: (count) => dependencies.progress?.(`Reading Notion: ${count} objects.`),
          onVerification: (count, total) =>
            dependencies.progress?.(`Verifying Notion: ${count}/${total} objects.`),
        }),
        isUuid(id) ? id : undefined,
        { excludedDatabaseIds },
      );
    }
    if (!apply) {
      const totals = plan.report.totals;
      const codes = [...new Set(plan.report.issues.map((issue) => issue.code))].sort();
      print(
        json
          ? JSON.stringify(plan.report)
          : `Preview ${plan.id}: ${totals.pages} pages, ${totals.databases} databases, ${totals.sources} sources, ${totals.memberships} entries, ${totals.attachments} attachments; ${totals.issues} notices. ${codes.join(", ")}`,
      );
      return 0;
    }
    target ??= await openTarget();
    dependencies.progress?.("Source verified; preparing safety backup and protected application.");
    const result = await applyNotionImport(plan, target, {
      signal: dependencies.signal,
      afterOperation: async (count) => {
        if (count % 25 === 0)
          dependencies.progress?.(`Applying import: ${count} accepted operations.`);
      },
    });
    print(
      json
        ? JSON.stringify({ ...result, report: plan.report })
        : `Import ${plan.id}: ${result.alreadyComplete ? "already complete" : "complete"}; root ${result.rootId}; safety backup ${result.backupId}; ${plan.report.totals.issues} notices. Resume: --resume --id ${plan.id}.`,
    );
    return 0;
  } catch (error) {
    const code = error instanceof NotionImportError ? error.code : "import.unavailable";
    print(
      json
        ? JSON.stringify({
            code,
            ...(error instanceof NotionImportError && error.sourcePath
              ? { sourcePath: error.sourcePath }
              : {}),
          })
        : code,
    );
    return code === "import.invalid-arguments" ? 2 : 1;
  } finally {
    await target?.close();
  }
}
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    process.exitCode = await runNotionImportCli(
      process.argv.slice(2),
      (line) => process.stdout.write(`${line}\n`),
      process.env,
      { signal: abort.signal, progress: (message) => process.stderr.write(`${message}\n`) },
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
