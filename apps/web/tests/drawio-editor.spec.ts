/**
 * The diagram editor may only be served by this installation (T030, FR-011).
 *
 * Tested as a pure function because the failure it prevents is not a bug in the
 * usual sense: a third-party origin here does not break the editor, it works
 * perfectly and sends the owner's diagrams to someone else on every edit. That
 * is invisible from the screen, so it has to be caught here.
 *
 * The check lists known public hosts rather than allowing known private ones,
 * because an installation legitimately sits on whatever hostname its owner
 * chose. What must never happen is the one specific thing.
 */

import { describe, expect, it } from "vitest";
import { assertLocalEditor } from "../src/features/files/drawio-editor.tsx";

describe("where the diagram editor may be loaded from", () => {
  it.each([
    "http://127.0.0.1:8081",
    "http://localhost:8081",
    "https://notes.example.org",
    "https://myownnotion.internal:8443",
  ])("accepts %s, which is an installation's own origin", (origin) => {
    expect(() => assertLocalEditor(origin)).not.toThrow();
  });

  it.each([
    "https://embed.diagrams.net",
    "https://app.diagrams.net",
    "https://diagrams.net",
    "https://www.draw.io",
    "https://draw.io",
    "https://jgraph.com",
  ])("refuses %s, which would send diagrams to a third party", (origin) => {
    expect(() => assertLocalEditor(origin)).toThrow(/third party/i);
  });

  it("names the host in the refusal so a misconfiguration is obvious", () => {
    // The message is read by whoever deployed it, at the moment they are
    // wondering why the editor will not open. Naming the host is the
    // difference between a two-minute fix and an afternoon.
    expect(() => assertLocalEditor("https://embed.diagrams.net")).toThrow(/embed\.diagrams\.net/);
  });

  it("refuses something that is not a URL rather than letting it through", () => {
    // A malformed origin cannot be checked, and "cannot be checked" must not
    // resolve to "allowed" when the thing being checked is a data leak.
    expect(() => assertLocalEditor("not a url")).toThrow();
    expect(() => assertLocalEditor("")).toThrow();
  });

  it("is not fooled by a subdomain of a forbidden host", () => {
    expect(() => assertLocalEditor("https://sneaky.diagrams.net")).toThrow(/third party/i);
  });

  it("does not refuse a private host that merely contains a forbidden name", () => {
    // `diagrams.net.internal.example.org` is somebody's own machine, not the
    // public service: the check compares hosts and suffixes, not substrings.
    expect(() => assertLocalEditor("https://diagrams.net.internal.example.org")).not.toThrow();
  });
});
