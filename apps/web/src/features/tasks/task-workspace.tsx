import {
  filterTaskProjections,
  TASK_PRIORITIES,
  TASK_SCOPES,
  TASK_SORTS,
  TASK_STATUSES,
  type TaskPriority,
  type TaskProjection,
  type TaskScope,
  type TaskSort,
  type TaskStatus,
  type Uuid,
} from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { TaskBoard } from "./task-board.tsx";
import { TaskList } from "./task-list.tsx";

const SCOPE_LABELS: Readonly<Record<TaskScope, string>> = {
  all: "All",
  today: "Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  finished: "Finished",
};

const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
};

const SORT_LABELS: Readonly<Record<TaskSort, string>> = {
  due_date: "Due date",
  priority: "Priority",
  source_page: "Source page",
  document_order: "Document order",
};

function localCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function TaskWorkspace({
  service,
  onOpenTask,
}: {
  readonly service: LocalContentService;
  readonly onOpenTask: (sourceItemId: Uuid, taskId: Uuid) => void;
}) {
  const [tasks, setTasks] = useState<TaskProjection[]>([]);
  const [legacyPageCount, setLegacyPageCount] = useState(0);
  const [mode, setMode] = useState<"list" | "board">("list");
  const [scope, setScope] = useState<TaskScope>("all");
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [priorities, setPriorities] = useState<TaskPriority[]>([]);
  const [sort, setSort] = useState<TaskSort>("due_date");

  const refresh = useCallback(async () => {
    const data = await service.getTaskWorkspaceData();
    setTasks(data.tasks);
    setLegacyPageCount(data.legacyPageCount);
  }, [service]);

  useEffect(() => {
    void refresh();
    return service.subscribe(() => void refresh());
  }, [refresh, service]);

  const filtered = useMemo(
    () =>
      filterTaskProjections(tasks, {
        today: localCalendarDate(),
        scope,
        query,
        statuses,
        priorities,
        sort,
      }),
    [priorities, query, scope, sort, statuses, tasks],
  );

  return (
    <section
      className="panel task-workspace"
      aria-labelledby="task-workspace-heading"
      data-testid="task-workspace"
    >
      <div className="task-workspace-heading">
        <div>
          <h2 id="task-workspace-heading">Tasks</h2>
          <p className="muted">Plan tasks stored inside your pages, including while offline.</p>
        </div>
        <fieldset className="task-view-switch">
          <legend className="visually-hidden">Task view</legend>
          <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}>
            List
          </button>
          <button type="button" aria-pressed={mode === "board"} onClick={() => setMode("board")}>
            Board
          </button>
        </fieldset>
      </div>

      <fieldset className="task-scope-switch">
        <legend className="visually-hidden">Task scope</legend>
        {TASK_SCOPES.map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={scope === value}
            onClick={() => setScope(value)}
          >
            {SCOPE_LABELS[value]}
          </button>
        ))}
      </fieldset>

      <div className="task-filter-bar">
        <label>
          <span>Search tasks</span>
          <input
            type="search"
            value={query}
            placeholder="Title or source page"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Sort tasks</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as TaskSort)}>
            {TASK_SORTS.map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <details className="task-filter-details">
          <summary>Filters</summary>
          <div className="task-filter-groups">
            <fieldset>
              <legend>Status</legend>
              {TASK_STATUSES.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    checked={statuses.includes(status)}
                    onChange={() => setStatuses((current) => toggleValue(current, status))}
                  />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Priority</legend>
              {TASK_PRIORITIES.map((priority) => (
                <label key={priority}>
                  <input
                    type="checkbox"
                    checked={priorities.includes(priority)}
                    onChange={() => setPriorities((current) => toggleValue(current, priority))}
                  />
                  {PRIORITY_LABELS[priority]}
                </label>
              ))}
            </fieldset>
          </div>
        </details>
      </div>

      <output className="task-count" data-testid="task-count" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "task" : "tasks"}
      </output>

      {legacyPageCount > 0 ? (
        <p className="status-banner" data-state="pending" data-testid="legacy-task-guidance">
          {legacyPageCount} legacy {legacyPageCount === 1 ? "page contains" : "pages contain"}{" "}
          checklist items. Open and save {legacyPageCount === 1 ? "it" : "them"} to assign durable
          task identities and include them here.
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="empty-state" data-testid="task-empty-state">
          No tasks match the current scope and filters.
        </p>
      ) : mode === "list" ? (
        <TaskList tasks={filtered} onOpenTask={onOpenTask} />
      ) : (
        <TaskBoard tasks={filtered} onOpenTask={onOpenTask} />
      )}
    </section>
  );
}
