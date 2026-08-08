import {
  buildTaskProjections,
  filterTaskProjections,
  groupTaskProjectionsByStatus,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { buildTaskFixture, TASK_CALENDAR_FIXTURE } from "../fixtures/tasks.ts";

describe("task workspace performance", () => {
  it("extracts, filters, sorts, and groups 5,000 tasks within one second", () => {
    const fixture = buildTaskFixture(5_000);
    const durations: number[] = [];
    let visibleCount = 0;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const started = performance.now();
      const tasks = buildTaskProjections(fixture);
      const visible = filterTaskProjections(tasks, {
        today: TASK_CALENDAR_FIXTURE.today,
        scope: "all",
        query: "Task 00",
        statuses: ["todo", "in_progress"],
        priorities: ["medium", "high"],
        sort: iteration % 2 === 0 ? "due_date" : "priority",
      });
      const groups = groupTaskProjectionsByStatus(visible);
      visibleCount = Object.values(groups).reduce((count, group) => count + group.length, 0);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    console.info(`[perf] 5,000-task projection/filter/sort p95=${p95.toFixed(1)}ms`);
    expect(visibleCount).toBeGreaterThan(0);
    expect(p95).toBeLessThan(1_000);
  });
});
