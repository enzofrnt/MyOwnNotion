/**
 * Static security analysis gate (feature 002, FR-023/FR-030/FR-033/FR-035).
 *
 * These rules encode this repository's own security invariants — the ones a
 * generic analyzer cannot know — and block on any high-confidence finding:
 *
 *   - the production session cookie is never issued without `Secure`;
 *   - the loopback development cookie never borrows the `__Host-` prefix;
 *   - secret material never reaches a log, a URL, or persistent plaintext;
 *   - a hosting-administrator remote HTTP route is never introduced (V1
 *     administration is the protected local CLI only);
 *   - dangerous dynamic evaluation and disabled TLS verification are absent.
 *
 * Output artifact: `static-security.sarif` (SARIF 2.1.0), always written.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const artifactPath = path.join(repoRoot, "static-security.sarif");

interface Rule {
  id: string;
  description: string;
  pattern: RegExp;
  /** Optional guard: when it matches the same line, the line is compliant. */
  satisfiedBy?: RegExp;
  appliesTo?: RegExp;
}

const rules: Rule[] = [
  {
    id: "host-cookie-requires-secure",
    description: "`__Host-mn_session` must be issued with the Secure attribute",
    pattern: /__Host-mn_session[^\n]*(?:setCookie|Set-Cookie|serialize)/i,
    satisfiedBy: /\bsecure\b/i,
  },
  {
    id: "dev-cookie-must-not-use-host-prefix",
    description: "The loopback development cookie must not use the `__Host-` prefix",
    pattern: /__Host-mn_dev_session/,
  },
  {
    id: "no-secret-in-log",
    description: "Secret or credential material must never be written to a log",
    pattern:
      /\b(?:console\.(?:log|info|warn|error|debug)|logger?\.(?:info|warn|error|debug|trace))\s*\([^)]*\b(?:deploymentKey|wrappingKey|privateKey|recoveryKit|passphrase|csrfToken|bootstrapCapability|sessionToken|plaintext)\b/i,
  },
  {
    id: "no-secret-in-url",
    description: "Capability, CSRF, or kit material must never travel in a URL or query string",
    pattern:
      /(?:searchParams\.(?:set|append)|[?&])\s*["']?(?:capability|bootstrapCapability|csrf|csrfToken|token|kit|passphrase)["']?\s*[=,]/i,
  },
  {
    id: "no-remote-administrator-route",
    description:
      "V1 administration is the protected local CLI only: no remote administrator HTTP route",
    pattern:
      /\b(?:get|post|put|patch|delete|route)\s*\(\s*["'`]\/(?:v1\/)?(?:admin|administrator)\b/i,
  },
  {
    id: "no-admin-bearer-scheme",
    description: "No hosting-administrator bearer capability or API token transport",
    pattern:
      /\b(?:Authorization|authorization)\s*[:=]\s*["'`]\s*Bearer\s+\$\{?\s*(?:admin|hosting)/i,
  },
  {
    id: "no-disabled-tls-verification",
    description: "TLS certificate verification must never be disabled",
    pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["']?0|rejectUnauthorized\s*:\s*false/,
  },
  {
    id: "no-dynamic-evaluation",
    description: "Dynamic code evaluation is forbidden in first-party source",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    id: "no-insecure-random-for-secrets",
    description: "Security material must use node:crypto, never Math.random()",
    pattern:
      /\b(?:token|secret|nonce|salt|capability|challenge|sessionId)\w*\s*=\s*[^\n;]*Math\.random\s*\(/i,
  },
  {
    id: "no-weak-hash-for-credentials",
    description: "Credential or capability hashing must not use MD5 or SHA-1",
    pattern: /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)/i,
  },
];

/** First-party source only; specs, docs, and this analyzer are excluded. */
const includedPrefixes = ["apps/", "packages/", "scripts/", "tests/"];
const excludedPrefixes = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "scripts/ci/static-security.ts",
];
const sourceExtensions = new Set([".ts", ".tsx"]);

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

const findings: Finding[] = [];
let scanned = 0;

for (const file of trackedFiles()) {
  if (!includedPrefixes.some((prefix) => file.startsWith(prefix))) {
    continue;
  }
  if (excludedPrefixes.some((prefix) => file.startsWith(prefix) || file.includes(`/${prefix}`))) {
    continue;
  }
  if (!sourceExtensions.has(path.extname(file))) {
    continue;
  }

  scanned += 1;
  const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.includes("static-security:allow")) {
      continue;
    }
    for (const rule of rules) {
      if (rule.appliesTo && !rule.appliesTo.test(file)) {
        continue;
      }
      if (!rule.pattern.test(line)) {
        continue;
      }
      if (rule.satisfiedBy?.test(line)) {
        continue;
      }
      findings.push({ ruleId: rule.id, description: rule.description, file, line: index + 1 });
    }
  }
}

const sarif = {
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "myownnotion-static-security",
          informationUri: "https://github.com/enzofournet/MyOwnNotion",
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
        message: { text: finding.description },
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

if (findings.length > 0) {
  console.error(`Static security analysis failed: ${findings.length} finding(s).\n`);
  for (const finding of findings) {
    console.error(`  - ${finding.file}:${finding.line} [${finding.ruleId}] ${finding.description}`);
  }
  console.error(`\nSARIF artifact: ${path.relative(repoRoot, artifactPath)}`);
  process.exit(1);
}

console.info(`Static security analysis passed (${scanned} source files, 0 findings).`);
