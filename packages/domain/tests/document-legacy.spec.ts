/**
 * Reading a version 1 body without destroying it (T014, FR-006).
 *
 * These tests exist because the tempting implementation is the wrong one. It
 * would be easy to parse a legacy body into blocks on open, write the result
 * back, and call the migration done — and every one of those steps loses
 * something an owner cannot get back.
 *
 * Two facts constrain the design and are asserted here.
 *
 * **The server cannot do this.** Since feature 002 the body is a sealed
 * envelope and the server holds no key, so there is no server-side migration to
 * fall back on. The client is the only place it can happen.
 *
 * **A read is not a write.** A client that rewrites an owner's stored document
 * because it prefers a different version is doing something the owner did not
 * ask for and cannot audit.
 */

import { describe, expect, it } from "vitest";
import {
  generateUuidV7,
  isUnknownBlock,
  isUpgradedLegacyDocument,
  readDocumentBody,
  serialiseDocument,
  upgradeLegacyBody,
} from "../src/index.ts";

describe("deciding how a body is read", () => {
  it("reads a body with blocks as a version 2 document", () => {
    const read = readDocumentBody({
      blocks: [{ type: "paragraph", id: generateUuidV7(), content: [{ text: "hi" }] }],
    });
    expect(read.kind).toBe("blocks");
  });

  it("reads a free-form body as legacy", () => {
    const read = readDocumentBody({ notes: "written by an older client", count: 3 });
    expect(read.kind).toBe("legacy");
  });

  it("dispatches on the body's shape rather than on a version number alone", () => {
    // A version number can be wrong — restored from a backup, written by a
    // client mid-upgrade — and the body either has blocks or it does not. The
    // content wins, for the same reason the sealed envelope wins over a
    // migration flag in feature 002.
    const read = readDocumentBody({ formatVersion: 1, blocks: [] });
    expect(read.kind).toBe("blocks");
  });

  it("treats a non-object body as an empty legacy body rather than throwing", () => {
    expect(readDocumentBody(null).kind).toBe("legacy");
    expect(readDocumentBody("nonsense").kind).toBe("legacy");
  });

  it("reads an empty object as an empty document, not as legacy content", () => {
    // The shape every newly created page starts with. Reading `{}` as legacy
    // told an owner their brand-new page "was written before the block editor
    // existed" and refused to let them type in it — a defect an end-to-end
    // journey found and no unit test would have, because the unit tests all
    // supplied a body with something in it.
    //
    // Safe precisely because `{}` carries no content: there is nothing to
    // preserve, which is not true of any other legacy body.
    const read = readDocumentBody({});
    expect(read.kind).toBe("blocks");
    if (read.kind === "blocks" && read.result.ok) {
      expect(read.result.document.blocks).toEqual([]);
    }
  });

  it("still reads a non-empty free-form body as legacy", () => {
    // The boundary of the rule above: one key is enough to make it content
    // somebody may care about.
    expect(readDocumentBody({ text: "something" }).kind).toBe("legacy");
  });
});

describe("upgrading, which happens only on an edit", () => {
  it("preserves the original body inside the upgraded document", () => {
    const original = { notes: "written by an older client", nested: { a: [1, 2, 3] } };
    const upgraded = upgradeLegacyBody(original);
    const serialised = serialiseDocument(upgraded) as { blocks: { body: unknown }[] };
    expect(serialised.blocks[0]?.body).toEqual(original);
  });

  it("carries the original by reference rather than copying it", () => {
    // Not pedantry: a copy is a re-keying, and a re-keying is what makes
    // "byte for byte" stop being true.
    const original = { notes: "kept" };
    const upgraded = upgradeLegacyBody(original);
    const block = upgraded.blocks[0];
    const raw = block !== undefined && isUnknownBlock(block) ? block.raw : {};
    expect((raw as { body: unknown }).body).toBe(original);
  });

  it("stores the legacy body as an unknown block, not a special case", () => {
    // The point of the design: no separate preservation path had to be
    // written, because a legacy body *is* content this client cannot render.
    const upgraded = upgradeLegacyBody({ notes: "kept" });
    const block = upgraded.blocks[0];
    expect(block !== undefined && isUnknownBlock(block)).toBe(true);
    expect(isUpgradedLegacyDocument(upgraded)).toBe(true);
  });

  it("produces a document that round-trips unchanged", () => {
    const upgraded = upgradeLegacyBody({ notes: "kept", n: 1 });
    const once = serialiseDocument(upgraded);
    const reread = readDocumentBody(once);
    expect(reread.kind).toBe("blocks");
    if (reread.kind === "blocks" && reread.result.ok) {
      expect(serialiseDocument(reread.result.document)).toEqual(once);
    }
  });

  it("derives the same identity from the same body, on every migration", () => {
    // Page activation compares digests between two independent migrations of
    // one stored body — client and server, or two devices offline. A random
    // id made those documents differ every time, so a legacy page could never
    // be activated. The id is now a pure function of the body.
    const first = upgradeLegacyBody({ text: "written by an older client", count: 3 });
    const second = upgradeLegacyBody({ count: 3, text: "written by an older client" });
    const other = upgradeLegacyBody({ text: "something else" });
    expect(first.blocks[0]?.id).toBe(second.blocks[0]?.id);
    expect(first.blocks[0]?.id).not.toBe(other.blocks[0]?.id);
  });
});
