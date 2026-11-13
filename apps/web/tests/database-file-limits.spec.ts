import { describe, expect, it } from "vitest";
import {
  databaseFileLimitBytes,
  databaseFileLimitLabel,
} from "../src/features/databases/file-property-field.tsx";

const file = (name: string, type: string) => ({ name, type });

describe("database file limits", () => {
  it("matches Notion's documented limits", () => {
    expect(databaseFileLimitBytes(file("photo.png", "image/png"))).toBe(5 * 1024 * 1024);
    expect(databaseFileLimitBytes(file("brief.pdf", "application/pdf"))).toBe(20 * 1024 * 1024);
    expect(databaseFileLimitBytes(file("archive.zip", "application/zip"))).toBe(5 * 1024 * 1024);
    expect(databaseFileLimitLabel(file("brief.pdf", "application/pdf"))).toBe("20 Mo");
  });

  it("detects images by MIME type or extension", () => {
    expect(databaseFileLimitBytes(file("photo", "image/webp"))).toBe(5 * 1024 * 1024);
    expect(databaseFileLimitBytes(file("photo", "application/octet-stream"))).toBe(5 * 1024 * 1024);
    expect(databaseFileLimitBytes(file("photo.JPG", ""))).toBe(5 * 1024 * 1024);
  });
});
