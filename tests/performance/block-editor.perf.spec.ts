import { type EditorDocument, validateEditorDocument } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { SaveCoordinator } from "../../apps/web/src/features/editor/save-coordinator.ts";

const BLOCK_COUNT = 2_000;

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] as number;
}

function largeDocument(): EditorDocument {
  return {
    type: "doc",
    content: Array.from({ length: BLOCK_COUNT }, (_, index) => ({
      type: "paragraph",
      content: [{ type: "text", text: `Representative block ${index}` }],
    })),
  };
}

describe("2,000-block editor pipeline", () => {
  it("keystroke validation and render/save preparation stay below 100ms p95", () => {
    const base = largeDocument();
    const samples: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      const first = base.content[0];
      if (first === undefined) {
        throw new Error("Performance fixture must contain a first block");
      }
      const next: EditorDocument = {
        ...base,
        content: [
          {
            ...first,
            content: [{ type: "text", text: `Representative block 0${"x".repeat(index + 1)}` }],
          },
          ...base.content.slice(1),
        ],
      };
      const validated = validateEditorDocument(next);
      expect(validated.ok).toBe(true);
      JSON.stringify(next);
      samples.push(performance.now() - started);
    }
    const p95 = percentile(samples, 0.95);
    console.info(`[perf] 2,000-block editor preparation p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(100);
  });

  it("coalesces a rapid burst and durably writes only the newest document", async () => {
    const saved: EditorDocument[] = [];
    const coordinator = new SaveCoordinator<EditorDocument>({
      delayMs: 0,
      save: async (document) => {
        saved.push(document);
      },
    });
    const base = largeDocument();
    for (let index = 0; index < 200; index += 1) {
      coordinator.schedule({
        ...base,
        content: [
          { type: "paragraph", content: [{ type: "text", text: `Latest ${index}` }] },
          ...base.content.slice(1),
        ],
      });
    }
    await coordinator.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.content[0]?.content?.[0]?.text).toBe("Latest 199");
  });
});
