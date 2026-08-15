/**
 * Secret scan gate (feature 002, FR-030/FR-033/FR-035).
 *
 * Blocking rule: any detected secret, or any failure of this scanner, blocks
 * the quality gate. The scan covers every tracked file, because a secret that
 * reaches version control has already leaked even if a later commit removes it.
 *
 * Output artifact: `secret-scan.sarif` (SARIF 2.1.0), always written, so the
 * aggregate gate can distinguish "clean" from "never ran".
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const artifactPath = path.join(repoRoot, "secret-scan.sarif");

interface Rule {
  id: string;
  description: string;
  pattern: RegExp;
  /**
   * When true the rule is a heuristic on *naming*, not on a recognisable
   * credential format, so it is limited to shipped source. Test fixtures
   * legitimately declare variables called `secret` holding redaction probes.
   * Format-based rules below stay active everywhere, including tests.
   */
  shippedSourceOnly?: boolean;
  /** Limits the rule to files whose path matches, when the form is format-specific. */
  appliesTo?: RegExp;
}

const testPathPattern = /(?:^|\/)tests?\//;

/**
 * Patterns describe secret *values*, not the variable names that reference
 * them. `.env.example` documents `MYOWNNOTION_DEPLOYMENT_KEY_FILE=/run/...`,
 * a path, and must stay clean.
 */
const rules: Rule[] = [
  {
    id: "private-key-block",
    description: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: "aws-access-key-id",
    description: "AWS access key ID",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: "github-token",
    description: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  },
  {
    id: "slack-token",
    description: "Slack token",
    pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: "jwt",
    description: "JSON Web Token literal",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: "generic-assigned-secret-literal",
    description: "Secret-looking name assigned a quoted literal value",
    // Code: only a *quoted* value can be a hard-coded secret. An unquoted
    // right-hand side is an identifier, a call, or a type reference —
    // `credentialIdDigest: Base64UrlOfBytes(...)` is a schema, not a secret.
    pattern:
      /\b(?!\w*_FILE\b)\w*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)\w*\s*[:=]\s*(["'`])(?!\s*\1)[A-Za-z0-9+/=_-]{16,}\1/i,
    shippedSourceOnly: true,
    appliesTo: /\.(?:ts|tsx|js|jsx|mjs|cjs)$/,
  },
  {
    id: "generic-assigned-secret-env",
    description: "Secret-looking environment assignment with a literal value",
    // Configuration: `SECRET=value` with no quotes is the normal form, so the
    // value is matched bare. `${…}` interpolation is stripped before matching.
    pattern:
      /^\s*(?:-\s*)?(?!\w*_FILE\b)\w*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)\w*\s*[:=]\s*["']?(?!\s*$)[A-Za-z0-9+/=_-]{16,}["']?\s*$/i,
    appliesTo: /\.(?:env|ya?ml|example|toml|ini|cfg|conf|properties)$|(?:^|\/)\.env/,
  },
  {
    id: "postgres-url-with-password",
    description: "Database URL embedding a non-development password",
    pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:(?!myownnotion-dev\b)[^\s:@/]{8,}@/,
  },
];

/** Files whose content is expected to contain secret-shaped test material. */
const allowedPaths = new Set<string>([
  "scripts/ci/scan-secrets.ts",
  "pnpm-lock.yaml", // integrity hashes, not credentials
]);

const skippedPrefixes = ["node_modules/", "dist/", "build/", "coverage/", ".pnpm-store/"];
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".zip",
  ".gz",
]);
const maxBytes = 4 * 1024 * 1024;

interface Finding {
  ruleId: string;
  description: string;
  file: string;
  line: number;
}

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter((entry) => entry.length > 0);
}

function writeSarif(findings: Finding[]): void {
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "myownnotion-secret-scan",
            informationUri: "https://github.com/enzofrnt/MyOwnNotion",
            rules: rules.map((rule) => ({
              id: rule.id,
              shortDescription: { text: rule.description },
              defaultConfiguration: { level: "error" },
            })),
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: "error",
          message: { text: `${finding.description} detected in tracked source` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                region: { startLine: finding.line },
              },
            },
          ],
        })),
      },
    ],
  };
  writeFileSync(artifactPath, `${JSON.stringify(sarif, null, 2)}\n`, "utf8");
}

const findings: Finding[] = [];
let scanned = 0;

for (const file of trackedFiles()) {
  if (allowedPaths.has(file)) {
    continue;
  }
  if (skippedPrefixes.some((prefix) => file.startsWith(prefix) || file.includes(`/${prefix}`))) {
    continue;
  }
  if (binaryExtensions.has(path.extname(file).toLowerCase())) {
    continue;
  }

  const absolute = path.join(repoRoot, file);
  let content: string;
  try {
    if (statSync(absolute).size > maxBytes) {
      continue;
    }
    content = readFileSync(absolute, "utf8");
  } catch {
    // A tracked path that cannot be read is a scanner failure, and a scanner
    // failure blocks: report it rather than silently passing the file.
    findings.push({
      ruleId: "scanner-unreadable-file",
      description: "Tracked file could not be read by the secret scanner",
      file,
      line: 1,
    });
    continue;
  }

  scanned += 1;
  const isTestFile = testPathPattern.test(file) || /\.(?:spec|test)\.[cm]?tsx?$/.test(file);
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.includes("secret-scan:allow")) {
      continue;
    }
    // `${VAR:-default}` in Compose/env files names a variable and its
    // non-secret fallback; the value itself is supplied at runtime.
    //
    // The placeholder is short and deliberately so. It replaced
    // `<interpolated>` — fourteen characters that every "long opaque string"
    // rule read as a password, so a Compose line built entirely from variables
    // was reported as a hard-coded credential. A substitution meant to remove
    // false positives must not look like the thing it is standing in for.
    const scannable = line.replaceAll(/\$\{[^}]*\}/g, "$VAR");
    for (const rule of rules) {
      if (rule.shippedSourceOnly && isTestFile) {
        continue;
      }
      if (rule.appliesTo && !rule.appliesTo.test(file)) {
        continue;
      }
      if (rule.pattern.test(scannable)) {
        findings.push({
          ruleId: rule.id,
          description: rule.description,
          file,
          line: index + 1,
        });
      }
    }
  }
}

writeSarif(findings);

if (findings.length > 0) {
  console.error(`Secret scan failed: ${findings.length} finding(s).\n`);
  for (const finding of findings) {
    console.error(`  - ${finding.file}:${finding.line} [${finding.ruleId}] ${finding.description}`);
  }
  console.error(`\nSARIF artifact: ${path.relative(repoRoot, artifactPath)}`);
  process.exit(1);
}

console.info(`Secret scan passed (${scanned} files scanned, 0 findings).`);
