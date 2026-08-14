/**
 * Rotation journeys (T080, US5, FR-017, FR-025 – FR-027).
 *
 * These journeys assert **wording**, which is unusual for an end-to-end test
 * and is the point of them.
 *
 * A rotation deadline is the one place in this application where the software
 * deliberately stops accepting an owner's work. What the screen says at that
 * moment decides what they do next: an owner who reads "blocked" and nothing
 * else concludes their notes are gone and starts restoring backups, deleting
 * volumes, and reinstalling — destroying the data the block was protecting. An
 * owner who reads that their notes are still readable and that rotating the
 * key restores saving has an inconvenience with a fix.
 *
 * A journey that only checked for a warning badge would pass in both cases.
 * So these check the sentences, in a real browser, against a real overdue
 * policy in a real database.
 */

import { randomBytes, scryptSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { resetCanonicalContent } from "./reset-content.ts";
import { resetSecurityInstallation, seedCommittedOwner } from "./reset-installation.ts";

const PASSWORD = "correct horse battery staple";
const DAY = 24 * 60 * 60 * 1000;

function connectionString(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion"
  );
}

function encodePassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

async function withClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function seedPassword(): Promise<void> {
  await withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM owners LIMIT 1`);
    const ownerId = rows[0]?.id;
    if (ownerId === undefined) {
      return;
    }
    await client.query(
      `INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
       VALUES (gen_random_uuid(), $1, $2, 'scrypt', 'active')`,
      [ownerId, encodePassword(PASSWORD)],
    );
  });
}

/**
 * A rotation policy positioned relative to now.
 *
 * Relative rather than absolute, because the application evaluates against its
 * own clock: a fixture pinned to a date would drift into a different state
 * every time the suite is run on a different day.
 */
async function seedPolicy(input: {
  kind: "wrapping-key" | "data-key";
  dueInDays: number;
  blockInDays: number;
  state: string;
  /**
   * Set for a failed rotation.
   *
   * The state an owner sees is *derived* — the stored `state` column is a
   * record of what the last transition wrote, and the evaluation recomputes it
   * from the dates and this column. Seeding only `state = 'failed'` produces a
   * fixture the application ignores, which is exactly the trap this journey
   * caught the first time it ran.
   */
  failedAgoDays?: number;
}): Promise<void> {
  await withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM installations LIMIT 1`);
    const installationId = rows[0]?.id;
    if (installationId === undefined) {
      return;
    }
    await client.query(
      `INSERT INTO rotation_policies
         (id, installation_id, kind, mode, due_interval_days, due_at, write_block_at,
          current_generation, state, last_failure_at)
       VALUES (gen_random_uuid(), $1, $2, 'scheduled', 365, $3, $4, 1, $5, $6)
       ON CONFLICT (installation_id, kind) DO UPDATE
         SET due_at = EXCLUDED.due_at,
             write_block_at = EXCLUDED.write_block_at,
             state = EXCLUDED.state,
             last_failure_at = EXCLUDED.last_failure_at`,
      [
        installationId,
        input.kind,
        new Date(Date.now() + input.dueInDays * DAY),
        new Date(Date.now() + input.blockInDays * DAY),
        input.state,
        input.failedAgoDays === undefined ? null : new Date(Date.now() - input.failedAgoDays * DAY),
      ],
    );
  });
}

test.beforeEach(async () => {
  await resetSecurityInstallation();
  await resetCanonicalContent();
  await seedCommittedOwner();
  await seedPassword();
});

async function openSecurity(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  if (!(await page.getByTestId("password-input").isVisible())) {
    await page.getByTestId("use-password-instead").click();
  }
  await page.getByTestId("password-input").fill(PASSWORD);
  await page.getByTestId("sign-in-password").click();
  await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("toggle-security-settings").click();
  await expect(page.getByRole("heading", { name: "Encryption keys" })).toBeVisible({
    timeout: 30_000,
  });
}

function panel(page: import("@playwright/test").Page) {
  return page.locator(".key-rotation-panel");
}

test.describe("a healthy installation", () => {
  test("shows both keys without alarming anyone", async ({ page }) => {
    await seedPolicy({ kind: "wrapping-key", dueInDays: 300, blockInDays: 307, state: "pre-due" });
    await seedPolicy({ kind: "data-key", dueInDays: 150, blockInDays: 180, state: "pre-due" });
    await openSecurity(page);

    await expect(panel(page)).toContainText("Installation key");
    await expect(panel(page)).toContainText("Note key");
    // No paused-changes banner on an installation with nothing wrong.
    await expect(panel(page)).not.toContainText("New changes are paused");
  });

  test("never uses the schema's words for the keys", async ({ page }) => {
    // "Wrapping key" and "data key" describe the mechanism. On a settings
    // screen an owner needs the consequence instead.
    await seedPolicy({ kind: "data-key", dueInDays: 150, blockInDays: 180, state: "pre-due" });
    await openSecurity(page);

    const text = (await panel(page).textContent()) ?? "";
    expect(text.toLowerCase()).not.toContain("wrapping key");
    expect(text.toLowerCase()).not.toContain("data key");
  });
});

test.describe("an overdue key", () => {
  test("counts the days until saving pauses", async ({ page }) => {
    await seedPolicy({
      kind: "data-key",
      dueInDays: -2,
      blockInDays: 3,
      state: "overdue-within-grace",
    });
    await openSecurity(page);

    // The deadline that matters is the write block, not the due date.
    await expect(panel(page)).toContainText(/Saving pauses in \d+ days?/);
  });
});

test.describe("a blocked installation", () => {
  test("says the notes are still readable", async ({ page }) => {
    // The journey this file exists for. An owner who concludes their notes are
    // gone does far more damage than the block ever prevents.
    await seedPolicy({ kind: "data-key", dueInDays: -400, blockInDays: -1, state: "write-block" });
    await openSecurity(page);

    await expect(panel(page)).toContainText(/still read/i);
  });

  test("says what restores saving", async ({ page }) => {
    await seedPolicy({ kind: "data-key", dueInDays: -400, blockInDays: -1, state: "write-block" });
    await openSecurity(page);

    // Naming the problem without naming the fix leaves an owner stuck at the
    // worst possible moment.
    await expect(panel(page)).toContainText(/rotat/i);
  });

  test("announces the pause to assistive technology", async ({ page }) => {
    await seedPolicy({ kind: "data-key", dueInDays: -400, blockInDays: -1, state: "write-block" });
    await openSecurity(page);

    // A status role, not styling alone: an owner using a screen reader must
    // learn that saving has paused on arrival, not by discovering it when an
    // edit fails.
    await expect(page.locator(".key-rotation-panel__blocked")).toHaveAttribute("role", "status");
  });

  test("still serves the workspace behind the warning", async ({ page }) => {
    // The guarantee the wording is describing. If reads actually failed here,
    // the reassuring sentence would be a lie, and this journey would be
    // asserting the wrong thing entirely.
    await seedPolicy({ kind: "data-key", dueInDays: -400, blockInDays: -1, state: "write-block" });
    await openSecurity(page);

    await page.getByTestId("toggle-security-settings").click();
    await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible();
  });
});

test.describe("a failed rotation", () => {
  test("says nothing was lost", async ({ page }) => {
    await seedPolicy({
      kind: "wrapping-key",
      dueInDays: -10,
      blockInDays: 20,
      state: "failed",
      failedAgoDays: 1,
    });
    await openSecurity(page);

    // A failed rotation is recoverable by construction: both key generations
    // stay readable. Told only "failed", an owner assumes otherwise.
    await expect(panel(page)).toContainText(/nothing was lost/i);
  });
});

test.describe("where rotation happens", () => {
  test("says it is run on the host, not from this screen", async ({ page }) => {
    await seedPolicy({ kind: "data-key", dueInDays: -1, blockInDays: 29, state: "due" });
    await openSecurity(page);

    // An owner who cannot find a button should learn it is absent by design
    // rather than assume they missed it.
    await expect(panel(page)).toContainText(/security rotation/);
    await expect(panel(page)).toContainText(/hosts this installation/i);
  });
});

test.describe("at a narrow viewport", () => {
  test("the warning is readable on a phone", async ({ page }) => {
    // The screen an owner reaches for when something is wrong is often the one
    // in their pocket, and a horizontally scrolling warning is one they will
    // not read.
    await seedPolicy({ kind: "data-key", dueInDays: -400, blockInDays: -1, state: "write-block" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openSecurity(page);

    await expect(panel(page)).toContainText(/still read/i);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
