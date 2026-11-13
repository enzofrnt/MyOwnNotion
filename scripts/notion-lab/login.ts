import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { capturesDir, ensurePrivateDir, openNotionProfile, say, timestamp, warn } from "./lib.ts";

/**
 * One-time manual step: open a normal Chromium window on Notion, let the owner
 * sign in (passkey, e-mail link, SSO), then close it. The session stays in the
 * local git-ignored profile.
 *
 *   bun run notion:login
 *   bun run notion:login -- --url https://www.notion.so/<workspace>
 */
const urlArgument = process.argv.slice(2).find((argument) => argument.startsWith("--url="));
const startUrl = urlArgument?.slice("--url=".length) || "https://www.notion.so/login";

if (!stdin.isTTY) {
  warn("notion:login doit être lancé depuis un terminal interactif.");
  process.exit(1);
}

const context = await openNotionProfile({ headless: false, theme: "light" });
const page = context.pages()[0] ?? (await context.newPage());

await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
say(
  [
    "",
    "Une fenêtre Chromium vient de s'ouvrir sur Notion.",
    "1. Connecte-toi normalement (passkey, e-mail, SSO).",
    "2. Ouvre l'espace et la page de base que je dois étudier.",
    "3. Reviens ici et appuie sur Entrée.",
    "",
    "La session reste dans .notion-lab/profile (ignoré par Git).",
    "",
  ].join("\n"),
);

const readline = createInterface({ input: stdin, output: stdout });
await readline.question("Connexion terminée ? Appuie sur Entrée… ");
readline.close();

await ensurePrivateDir(capturesDir);
const shot = join(capturesDir, `login-state-${timestamp()}.png`);
await page.screenshot({ path: shot, fullPage: false }).catch(() => undefined);
const currentUrl = page.url();
say(`URL finale : ${currentUrl}`);
if (currentUrl.includes("/login")) {
  warn("La page est encore sur /login : la session ne semble pas établie.");
} else {
  say("Session enregistrée. Tu peux fermer la fenêtre si elle est encore ouverte.");
}
await context.close().catch(() => undefined);
