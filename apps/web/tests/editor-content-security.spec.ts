import { describe, expect, it } from "vitest";
import { isSafeEmbedSource } from "../src/features/editor/custom-blocks/embed.tsx";
import { safeLinkHref, sanitizePastedBlocks } from "../src/features/editor/paste-sanitizer.ts";

describe("editor content security", () => {
  describe("embed allowlist", () => {
    it("accepts allowlisted provider hosts", () => {
      expect(isSafeEmbedSource("youtube", "https://www.youtube.com/watch?v=abc")).toBe(true);
      expect(isSafeEmbedSource("youtube", "https://youtu.be/abc")).toBe(true);
      expect(isSafeEmbedSource("vimeo", "https://player.vimeo.com/video/1")).toBe(true);
      expect(isSafeEmbedSource("github", "https://gist.github.com/a/1")).toBe(true);
      expect(isSafeEmbedSource("figma", "https://www.figma.com/file/x")).toBe(true);
      expect(isSafeEmbedSource("drawio", "https://app.diagrams.net/#x")).toBe(true);
    });

    it("refuses non-https, lookalike hosts and credential URLs", () => {
      expect(isSafeEmbedSource("youtube", "http://www.youtube.com/watch?v=abc")).toBe(false);
      expect(isSafeEmbedSource("youtube", "https://notyoutube.com/watch?v=abc")).toBe(false);
      expect(isSafeEmbedSource("vimeo", "https://vimeo.com.evil.test/video/1")).toBe(false);
      expect(isSafeEmbedSource("github", "https://user:token@github.com/a")).toBe(false);
    });

    it("refuses secret-bearing query parameters and oversized URLs", () => {
      expect(isSafeEmbedSource("bookmark", "https://a.test/?token=secret")).toBe(false);
      expect(isSafeEmbedSource("bookmark", `https://a.test/?q=${"x".repeat(3_000)}`)).toBe(false);
    });
  });

  describe("paste link sanitisation", () => {
    it("keeps safe schemes", () => {
      expect(safeLinkHref("https://example.org/a")).toBe("https://example.org/a");
      expect(safeLinkHref("mailto:owner@example.org")).toBe("mailto:owner@example.org");
      expect(safeLinkHref("myownnotion:page:0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056")).toBe(
        "myownnotion:page:0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056",
      );
    });

    it("strips executable and opaque schemes", () => {
      expect(safeLinkHref("javascript:alert(1)")).toBeNull();
      expect(safeLinkHref("data:text/html,<script>alert(1)</script>")).toBeNull();
      expect(safeLinkHref("file:///etc/passwd")).toBeNull();
      expect(safeLinkHref("vbscript:msgbox")).toBeNull();
    });
  });

  describe("paste structure reduction", () => {
    it("preserves every character while reducing unrepresentable blocks", () => {
      const { blocks, reduced } = sanitizePastedBlocks([
        {
          type: "fancyWidgetFromAnotherApp",
          content: [{ type: "text", text: "texte conservé" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "lien sûr " },
            { type: "link", href: "https://example.org", content: [{ type: "text", text: "ok" }] },
            {
              type: "link",
              href: "javascript:alert(1)",
              content: [{ type: "text", text: "piège" }],
            },
          ],
        },
      ]);

      expect(reduced).toBe(true);
      const texts = JSON.stringify(blocks).match(/[^"]+(?=")/gu) ?? [];
      expect(JSON.stringify(blocks)).toContain("texte conservé");
      expect(JSON.stringify(blocks)).toContain("piège");
      expect(texts).not.toContain("javascript");
      expect(blocks[0]?.type).toBe("paragraph");
    });

    it("never produces a block type outside the canonical schema", () => {
      const representable = new Set([
        "paragraph",
        "heading",
        "bulletListItem",
        "numberedListItem",
        "checkListItem",
        "quote",
        "codeBlock",
        "divider",
        "toggleListItem",
        "callout",
        "table",
        "tableRow",
        "tableCell",
        "image",
        "fileEmbed",
        "embed",
        "unknown",
      ]);
      const pasted = [
        { type: "aiPrompt", content: [{ type: "text", text: "a" }] },
        {
          type: "table",
          children: [
            {
              type: "tableRow",
              children: [{ type: "tableCell", content: [{ type: "text", text: "cell" }] }],
            },
          ],
        },
        { type: "quote", content: [{ type: "text", text: "citation" }] },
      ];
      const { blocks } = sanitizePastedBlocks(pasted);
      for (const block of blocks) {
        expect(representable.has(block.type)).toBe(true);
        for (const child of (block.children as Array<{ type: string }>) ?? []) {
          expect(representable.has(child.type)).toBe(true);
        }
      }
    });

    it("bounds pathological paste sizes without throwing", () => {
      const flood = Array.from({ length: 5_000 }, () => ({
        type: "paragraph",
        content: [{ type: "text", text: "x".repeat(100) }],
      }));
      const { blocks } = sanitizePastedBlocks(flood);
      expect(blocks.length).toBeLessThanOrEqual(500);
    });

    it("drops object-valued props that the schema cannot persist", () => {
      const { blocks, reduced } = sanitizePastedBlocks([
        {
          type: "paragraph",
          props: { textColor: "default", customObject: { nested: true } },
          content: [{ type: "text", text: "t" }],
        },
      ]);
      expect(reduced).toBe(true);
      expect(blocks[0]?.props).toEqual({ textColor: "default" });
    });
  });
});
