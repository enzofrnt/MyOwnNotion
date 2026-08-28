import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CalendarView,
  calendarDateKey,
  calendarMoveUpdate,
  calendarRows,
} from "../src/features/databases/calendar-view.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

const ids = {
  database: generateUuidV7(),
  revision: generateUuidV7(),
  view: generateUuidV7(),
  title: generateUuidV7(),
  due: generateUuidV7(),
  alpha: generateUuidV7(),
  beta: generateUuidV7(),
};

const instantProperty: DatabaseProperty = {
  id: ids.due,
  name: "Due",
  type: "date",
  positionKey: "b",
  state: "active",
  config: { mode: "instant" },
};

const view: Extract<DatabaseView, { type: "calendar" }> = {
  id: ids.view,
  name: "Delivery calendar",
  type: "calendar",
  positionKey: "a",
  state: "active",
  properties: [
    { propertyId: ids.title, visible: true, positionKey: "a" },
    { propertyId: ids.due, visible: true, positionKey: "b" },
  ],
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: { datePropertyId: ids.due, initialMode: "month" },
};

const page: DatabaseViewPage = {
  databaseId: ids.database,
  viewId: ids.view,
  definitionRevisionId: ids.revision,
  generation: 1,
  coverage: "complete",
  availableCount: 2,
  expectedCount: 2,
  rows: [
    {
      entryId: ids.alpha,
      revisionId: generateUuidV7(),
      title: "Alpha",
      values: { [ids.due]: { kind: "instant", instant: "2026-08-20T00:30:00.000Z" } },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
    {
      entryId: ids.beta,
      revisionId: generateUuidV7(),
      title: "Beta",
      values: {},
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
  ],
  groups: [],
  nextCursor: null,
  source: "local",
  staleCursorRecovered: false,
};

describe("database calendar view (T090)", () => {
  it("keeps civil dates stable and places instants on the viewer's local day", () => {
    expect(calendarDateKey({ kind: "date", date: "2026-08-20" }, "America/Los_Angeles")).toBe(
      "2026-08-20",
    );
    expect(
      calendarDateKey(
        { kind: "instant", instant: "2026-08-20T00:30:00.000Z" },
        "America/Los_Angeles",
      ),
    ).toBe("2026-08-19");
    expect(calendarDateKey({ kind: "instant", instant: "2026-08-20T00:30:00.000Z" }, "UTC")).toBe(
      "2026-08-20",
    );
  });

  it("preserves the local time when an instant is moved and keeps missing entries accessible", () => {
    expect(
      calendarMoveUpdate(
        instantProperty,
        "2026-08-21",
        { kind: "instant", instant: "2026-08-20T00:30:00.000Z" },
        "America/Los_Angeles",
      ),
    ).toEqual({
      kind: "property",
      propertyId: ids.due,
      value: { kind: "instant", instant: "2026-08-22T00:30:00.000Z" },
    });
    const grouped = calendarRows(page.rows, instantProperty, "America/Los_Angeles");
    expect(grouped.days.get("2026-08-19")?.map(({ title }) => title)).toEqual(["Alpha"]);
    expect(grouped.unscheduled.map(({ title }) => title)).toEqual(["Beta"]);
  });

  it("renders month navigation, local days, unscheduled entries and named date controls", () => {
    const markup = renderToStaticMarkup(
      createElement(CalendarView, {
        properties: [instantProperty],
        view,
        page,
        timeZone: "America/Los_Angeles",
        referenceDate: new Date("2026-08-01T12:00:00.000Z"),
        onOpenEntry: vi.fn(),
        onUpdateEntry: vi.fn(),
        onChangeView: vi.fn(),
      }),
    );
    expect(markup).toContain('aria-label="Vue calendrier Delivery calendar"');
    expect(markup).toContain("Mois précédent");
    expect(markup).toContain("Mois suivant");
    expect(markup).toContain("Non planifiées · 1");
    expect(markup).toContain("Alpha");
    expect(markup).toContain("Beta");
    expect(markup).toContain('aria-label="Planifier Alpha"');
    expect(markup).not.toContain('role="grid"');
  });
});
