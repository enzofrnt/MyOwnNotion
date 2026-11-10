import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { test } from "node:test";

function fixture() {
  return {
    url: "http://example.test/menu",
    container: { styles: {} },
    items: [
      {
        text: "Action",
        box: { x: 0, y: 0, width: 236, height: 28 },
        gapBefore: null,
        content: {
          svgs: [{ x: 8, y: 4, width: 20, height: 20 }],
          text: [
            {
              x: 36,
              y: 5,
              fontSize: "14px",
              fontWeight: "400",
              lineHeight: "16.8px",
              fontFamily: "system-ui, sans-serif",
            },
          ],
        },
        hover: { styles: { backgroundColor: "rgba(33, 27, 23, 0.05)", color: "rgb(44, 44, 43)" } },
      },
    ],
  };
}

function compare(mutator) {
  const directory = mkdtempSync(join(tmpdir(), "myownnotion-parity-test-"));
  try {
    const reference = fixture();
    const candidate = fixture();
    mutator(candidate);
    writeFileSync(join(directory, "reference.json"), JSON.stringify(reference));
    writeFileSync(join(directory, "candidate.json"), JSON.stringify(candidate));
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/notion-parity/compare.mjs"),
        "--reference",
        join(directory, "reference.json"),
        "--candidate",
        join(directory, "candidate.json"),
        "--out",
        join(directory, "report.md"),
        "--fail-on-gap",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.error, undefined);
    return result.status;
  } finally {
    const target = realpathSync(directory);
    assert.ok(target.startsWith(`${realpathSync(tmpdir())}${sep}`));
    assert.ok(basename(target).startsWith("myownnotion-parity-test-"));
    rmSync(target, { recursive: true });
  }
}

test("matching measurements pass", () =>
  assert.equal(
    compare(() => {}),
    0,
  ));
test("missing font-family is not a successful comparison", () => {
  assert.equal(
    compare((value) => {
      delete value.items[0].content.text[0].fontFamily;
    }),
    1,
  );
});
test("unexpected bold text fails", () => {
  assert.equal(
    compare((value) => {
      value.items[0].content.text[0].fontWeight = "600";
    }),
    1,
  );
});
test("oversized icon fails", () => {
  assert.equal(
    compare((value) => {
      value.items[0].content.svgs[0].width = 32;
    }),
    1,
  );
});
test("missing numeric geometry fails instead of silently comparing NaN", () => {
  assert.equal(
    compare((value) => {
      delete value.items[0].box.height;
    }),
    1,
  );
});
