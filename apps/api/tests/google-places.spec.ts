import { describe, expect, it } from "vitest";
import { createGooglePlaces, PlacesError } from "../src/places/google-places.ts";

type Reply = { status?: number; body?: unknown; throws?: boolean };

function provider(replies: { autocomplete?: Reply; text?: Reply; details?: Reply }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const reply = url.endsWith(":autocomplete")
      ? replies.autocomplete
      : url.endsWith(":searchText")
        ? replies.text
        : replies.details;
    if (reply === undefined || reply.throws === true) throw new Error("network down");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  };
  return { places: createGooglePlaces("server-key", fetcher), calls };
}

const louvre = {
  id: "louvre",
  displayName: { text: "Musée du Louvre" },
  formattedAddress: "99 Rue de Rivoli, 75001 Paris",
  location: { latitude: 48.86, longitude: 2.33 },
};
const prediction = (placeId: string, main: string, secondary: string) => ({
  placePrediction: {
    placeId,
    text: { text: `${main}, ${secondary}` },
    structuredFormat: { mainText: { text: main }, secondaryText: { text: secondary } },
  },
});
const input = { query: "musée du lou", limit: 10, language: "fr", sessionToken: "session-1234" };

describe("Google Places provider", () => {
  it("ranks typed predictions first and reuses coordinates already known", async () => {
    const { places, calls } = provider({
      autocomplete: {
        body: {
          suggestions: [
            prediction("lens", "Louvre-Lens", "Lens, France"),
            prediction("louvre", "Musée du Louvre", "Paris, France"),
          ],
        },
      },
      text: {
        body: { places: [louvre, { ...louvre, id: "cafe", displayName: { text: "Café" } }] },
      },
    });
    expect(await places.search(input)).toEqual([
      { placeId: "lens", name: "Louvre-Lens", address: "Lens, France" },
      {
        placeId: "louvre",
        name: "Musée du Louvre",
        address: "99 Rue de Rivoli, 75001 Paris",
        latitude: 48.86,
        longitude: 2.33,
      },
      {
        placeId: "cafe",
        name: "Café",
        address: "99 Rue de Rivoli, 75001 Paris",
        latitude: 48.86,
        longitude: 2.33,
      },
    ]);
    // The query travels in the body and the key in a header, never in a URL.
    for (const call of calls) {
      expect(call.url).not.toContain("lou");
      expect(call.url).not.toContain("server-key");
    }
  });

  it("still answers when only one of the two Google calls works", async () => {
    const { places } = provider({
      autocomplete: { status: 403 },
      text: { body: { places: [louvre] } },
    });
    expect((await places.search(input)).map(({ placeId }) => placeId)).toEqual(["louvre"]);
  });

  it("returns no suggestion rather than an error when Google finds nothing", async () => {
    const { places } = provider({ autocomplete: { body: {} }, text: { body: {} } });
    expect(await places.search(input)).toEqual([]);
  });

  it("reports quota, refusal and outage distinctly", async () => {
    await expect(
      provider({ autocomplete: { throws: true }, text: { status: 429 } }).places.search(input),
    ).rejects.toMatchObject({ reason: "quota" });
    await expect(
      provider({ autocomplete: { status: 403 }, text: { status: 403 } }).places.search(input),
    ).rejects.toMatchObject({ reason: "denied" });
    await expect(
      provider({ autocomplete: { throws: true }, text: { throws: true } }).places.search(input),
    ).rejects.toBeInstanceOf(PlacesError);
  });

  it("resolves a picked suggestion and refuses one without a location", async () => {
    const found = provider({ details: { body: louvre } });
    expect(await found.places.details("louvre", "fr", "session-1234")).toMatchObject({
      placeId: "louvre",
      latitude: 48.86,
    });
    expect(found.calls[0]?.url).toContain("sessionToken=session-1234");
    const missing = provider({ details: { body: { id: "x", displayName: { text: "X" } } } });
    expect(await missing.places.details("x", "fr")).toBeNull();
  });
});
