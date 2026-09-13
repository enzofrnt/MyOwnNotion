import process from "node:process";
import { isUuid } from "@myownnotion/domain";
import { fullBackupRoot } from "../../backup/backup-config.ts";
import { applyNotionImport } from "./apply.ts";
import { planNotionImport } from "./plan.ts";
import { NotionImportError, readImportSource } from "./source.ts";
import { openNotionTarget } from "./target.ts";

export const NOTION_IMPORT_HELP = `Notion import — preview first

  --source DIRECTORY_OR_ZIP [--id UUID] [--json] [--dry-run] [--apply]

Preview opens no target. --dry-run overrides --apply. Apply requires an explicit
import UUID and DATABASE_URL, MYOWNNOTION_BLOB_ROOT, MYOWNNOTION_BACKUP_ROOT,
MYOWNNOTION_DEPLOYMENT_KEY_FILE. A verified full backup precedes every new import.
Resume with exactly the same source and UUID. JSON is a detailed private report;
normal output contains counts and safe codes. No remote assets are downloaded.`;
export async function runNotionImportCli(
  argv: readonly string[],
  print: (line: string) => void,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  if (!argv.length || argv.includes("--help")) {
    print(NOTION_IMPORT_HELP);
    return 0;
  }
  let target: Awaited<ReturnType<typeof openNotionTarget>> | undefined;
  let json = false;
  try {
    const options: Record<string, string | boolean> = {};
    for (let index = 0; index < argv.length; index++) {
      const option = argv[index];
      if (
        !option ||
        !["--source", "--id", "--json", "--apply", "--dry-run"].includes(option) ||
        options[option] !== undefined
      )
        throw new NotionImportError("import.invalid-arguments");
      if (option === "--source" || option === "--id") {
        const value = argv[++index];
        if (!value || value.startsWith("--"))
          throw new NotionImportError("import.invalid-arguments");
        options[option] = value;
      } else options[option] = true;
    }
    json = options["--json"] === true;
    const source = options["--source"],
      id = options["--id"];
    const apply = options["--apply"] === true && options["--dry-run"] !== true;
    if (typeof source !== "string" || (id !== undefined && !isUuid(id)) || (apply && !isUuid(id)))
      throw new NotionImportError("import.invalid-arguments");
    const plan = planNotionImport(await readImportSource(source), isUuid(id) ? id : undefined);
    if (!apply) {
      print(
        json
          ? JSON.stringify(plan.report)
          : `Preview ${plan.id}: ${plan.report.totals.pages} pages, ${plan.report.totals.databases} sources, ${plan.report.totals.memberships} memberships, ${plan.report.totals.attachments} attachments, ${plan.report.totals.originals} preserved originals; ${plan.report.issues.length} conversion notices (${plan.report.issues.filter((issue) => issue.blocking).length} blocking). Use --json for the complete private report.`,
      );
      return 0;
    }
    const connectionString = env["DATABASE_URL"],
      blobRoot = env["MYOWNNOTION_BLOB_ROOT"],
      keyFile = env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"],
      backupRoot = env["MYOWNNOTION_BACKUP_ROOT"];
    if (!connectionString || !blobRoot || !keyFile || !backupRoot)
      throw new NotionImportError("import.target-configuration-required");
    target = await openNotionTarget({
      connectionString,
      blobRoot,
      keyFile,
      backupRoot: fullBackupRoot({ root: backupRoot }),
    });
    const result = await applyNotionImport(plan, target);
    print(
      json
        ? JSON.stringify({ ...result, report: plan.report })
        : `Import ${plan.id}: ${result.alreadyComplete ? "already complete" : "complete"}; root ${result.rootId}; safety backup ${result.backupId}.`,
    );
    return 0;
  } catch (error) {
    const code = error instanceof NotionImportError ? error.code : "import.unavailable";
    print(json ? JSON.stringify({ code }) : code);
    return code === "import.invalid-arguments" ? 2 : 1;
  } finally {
    await target?.close();
  }
}
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  process.exitCode = await runNotionImportCli(process.argv.slice(2), (line) =>
    process.stdout.write(`${line}\n`),
  );
}
