import { afterEach, beforeEach, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  ids: new Set<string>(),
  inserts: [] as unknown[][],
  loseReply: false,
  stallClose: false,
  destroy: vi.fn(),
}));
vi.mock("pg", () => ({
  default: {
    Client: class {
      connection = { stream: { destroy: database.destroy } };
      async connect() {}
      async query(sql: string, values: unknown[] = []) {
        if (sql.includes("SELECT id FROM owners")) return { rows: [{ id: "owner" }] };
        database.inserts.push(values);
        // Emulate the server committing before its response is lost. The old
        // fixture delegates identity creation to SQL, so each attempt differs.
        database.ids.add(
          sql.includes("gen_random_uuid()") ? crypto.randomUUID() : String(values[0]),
        );
        if (database.loseReply) {
          database.loseReply = false;
          throw Object.assign(new Error("connection reset after commit"), { code: "ECONNRESET" });
        }
        return { rows: [] };
      }
      end(): Promise<void> {
        return database.stallClose ? new Promise(() => {}) : Promise.resolve();
      }
    },
  },
}));

import { seedPassword } from "../../../tests/e2e/password-fixture.ts";

beforeEach(() => {
  vi.useFakeTimers();
  database.ids.clear();
  database.inserts = [];
  database.loseReply = false;
  database.stallClose = false;
  database.destroy.mockClear();
});
afterEach(() => vi.useRealTimers());

it("finishes a committed fixture when the owned socket never acknowledges close", async () => {
  database.stallClose = true;
  let finished = false;
  const pending = seedPassword("fixture-only").then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(1_500);
  expect(finished).toBe(true);
  expect(database.ids.size).toBe(1);
  expect(database.destroy).toHaveBeenCalledOnce();
  await pending;
});

it("retries a lost commit reply with the same credential identity and hash", async () => {
  database.loseReply = true;
  const result = seedPassword("fixture-only").then(
    () => "accepted",
    () => "refused",
  );
  await vi.advanceTimersByTimeAsync(1_500);
  expect(await result).toBe("accepted");
  expect(database.inserts).toHaveLength(2);
  expect(database.inserts[1]).toEqual(database.inserts[0]);
  expect(database.ids.size).toBe(1);
});
