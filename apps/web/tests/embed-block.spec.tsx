import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WebBookmarkCard,
  webBookmarkPresentation,
} from "../src/features/editor/custom-blocks/embed.tsx";

describe("full-line Web bookmark", () => {
  it("renders URL and domain from durable props without metadata or iframe", () => {
    const markup = renderToStaticMarkup(
      <WebBookmarkCard sourceUrl="https://www.example.com/docs?q=offline" />,
    );

    expect(markup).toContain("example.com");
    expect(markup).toContain("https://www.example.com/docs?q=offline");
    expect(markup).not.toContain("iframe");
    expect(markup).not.toContain("fetch");
  });

  it("rejects unsafe bookmark sources", () => {
    expect(webBookmarkPresentation("javascript:alert(1)")).toBeNull();
  });
});
