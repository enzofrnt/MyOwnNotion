// @vitest-environment jsdom
import type { DatabaseProperty, PlacePropertyValue, Uuid } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlacePropertyField } from "../src/features/databases/place-property-field.tsx";

const property: DatabaseProperty = {
  id: "018f5000-0000-7000-8000-000000000201" as Uuid,
  name: "Lieu",
  type: "place",
  positionKey: "z",
  state: "active",
  config: {},
};

interface Pending {
  readonly body: { q?: string; placeId?: string };
  readonly url: string;
  readonly signal: AbortSignal | undefined;
  readonly respond: (status: number, payload: unknown) => void;
  readonly fail: () => void;
}

describe("place property field", () => {
  let root: Root;
  let container: HTMLDivElement;
  let pending: Pending[];
  let onChange: ReturnType<typeof vi.fn<(value: PlacePropertyValue | null) => void>>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    pending = [];
    onChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          const signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
          pending.push({
            url,
            signal,
            body: JSON.parse(String(init?.body ?? "{}")),
            respond: (status, payload) =>
              resolve(new Response(JSON.stringify(payload), { status })),
            fail: () => reject(new TypeError("network")),
          });
        });
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(value: PlacePropertyValue | null = null): Promise<void> {
    await act(async () =>
      root.render(<PlacePropertyField property={property} value={value} onChange={onChange} />),
    );
  }
  const input = (): HTMLInputElement => container.querySelector("input") as HTMLInputElement;
  async function type(value: string): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(300));
  }
  async function settle(action: () => void): Promise<void> {
    await act(async () => {
      action();
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  const options = (): string[] =>
    [...container.querySelectorAll("[role=option] strong")].map((e) => e.textContent ?? "");
  const place = (placeId: string, name: string, located = true) => ({
    placeId,
    name,
    address: `${name}, France`,
    ...(located ? { latitude: 48.8, longitude: 2.3 } : {}),
  });

  it("keeps only the latest search when answers arrive out of order", async () => {
    await render();
    await type("par");
    await type("paris");
    expect(pending.map(({ body }) => body.q)).toEqual(["par", "paris"]);
    expect(pending[0]?.signal?.aborted).toBe(true);
    await settle(() => pending[1]?.respond(200, { places: [place("b", "Paris")] }));
    // The older request answers last: it must not replace the newer result.
    await settle(() => pending[0]?.respond(200, { places: [place("a", "Parme")] }));
    expect(options()).toEqual(["Paris"]);
  });

  it("drops a pending answer when the search is cleared", async () => {
    await render();
    await type("lyon");
    await type("");
    expect(pending[0]?.signal?.aborted).toBe(true);
    await settle(() => pending[0]?.respond(200, { places: [place("a", "Lyon")] }));
    expect(options()).toEqual([]);
    expect(container.textContent).not.toContain("Aucun lieu");
  });

  it("sends the search in the request body, never in the URL", async () => {
    await render();
    await type("rue secrète");
    expect(pending[0]?.url).toBe("/v1/places/search");
    expect(pending[0]?.body.q).toBe("rue secrète");
  });

  it("tells an empty result from an outage and from a missing key, with a retry", async () => {
    await render();
    await type("zzzz");
    await settle(() => pending[0]?.respond(200, { places: [] }));
    expect(container.textContent).toContain("Aucun lieu trouvé pour « zzzz »");

    await type("lille");
    await settle(() => pending[1]?.respond(502, { code: "places.unavailable" }));
    expect(container.textContent).toContain("Le service de lieux ne répond pas.");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Réessayer",
    );
    await act(async () => retry?.click());
    await act(async () => vi.advanceTimersByTime(300));
    expect(pending[2]?.body.q).toBe("lille");
    await settle(() => pending[2]?.respond(503, { code: "places.unconfigured" }));
    expect(container.textContent).toContain("n’est pas configurée");
    expect(container.textContent).not.toContain("Réessayer");
  });

  it("selects with the keyboard and resolves a suggestion without coordinates", async () => {
    await render();
    await type("louvre");
    await settle(() =>
      pending[0]?.respond(200, {
        places: [place("lens", "Louvre-Lens", false), place("paris", "Musée du Louvre")],
      }),
    );
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(pending[1]?.url).toBe("/v1/places/details");
    expect(pending[1]?.body.placeId).toBe("lens");
    expect(onChange).not.toHaveBeenCalled();
    await settle(() =>
      pending[1]?.respond(200, {
        place: {
          placeId: "lens",
          name: "Musée Louvre-Lens",
          address: "Lens",
          latitude: 50.4,
          longitude: 2.8,
        },
      }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      kind: "place",
      placeId: "lens",
      name: "Louvre-Lens",
      address: "Lens",
      latitude: 50.4,
      longitude: 2.8,
    });
  });

  it("stores nothing when the position is refused, and explains why", async () => {
    const getCurrentPosition = vi.fn((_ok: unknown, refuse: (error: { code: number }) => void) =>
      refuse({ code: 1 }),
    );
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition }, onLine: true });
    await render();
    const current = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Emplacement actuel",
    );
    await act(async () => current?.click());
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Autorisation de localisation refusée",
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
  });

  it("stores an authorized position locally without calling the place provider", async () => {
    const getCurrentPosition = vi.fn((ok: (position: unknown) => void) =>
      ok({ coords: { latitude: 48.856614, longitude: 2.3522219 } }),
    );
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition }, onLine: true });
    await render();
    const current = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Emplacement actuel",
    );
    await act(async () => current?.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      kind: "place",
      placeId: "geo:48.85661,2.35222",
      name: "Position actuelle",
      address: "48.85661, 2.35222",
      latitude: 48.85661,
      longitude: 2.35222,
    });
    expect(pending).toHaveLength(0);
  });
});
