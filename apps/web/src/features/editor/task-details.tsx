import { TASK_PRIORITIES, TASK_STATUSES } from "@myownnotion/domain";
import type { Editor } from "@tiptap/core";
import { findSelectedTaskItem, updateSelectedTaskItem } from "./task-item.ts";

const STATUS_LABELS = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
} as const;

const PRIORITY_LABELS = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

export function TaskDetails({
  editor,
  transactionVersion: _transactionVersion,
}: {
  readonly editor: Editor;
  /** Forces selection/attribute recomputation after editor transactions. */
  readonly transactionVersion: number;
}) {
  const selected = findSelectedTaskItem(editor);
  if (selected === null) {
    return null;
  }
  const { attrs } = selected;
  return (
    <fieldset className="task-details" data-testid="task-details">
      <legend>Task details</legend>
      <label>
        <span>Status</span>
        <select
          aria-label="Task status"
          value={attrs.status}
          onChange={(event) =>
            updateSelectedTaskItem(editor, {
              status: event.target.value as (typeof TASK_STATUSES)[number],
            })
          }
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Due date</span>
        <input
          aria-label="Task due date"
          type="date"
          value={attrs.dueDate ?? ""}
          onChange={(event) =>
            updateSelectedTaskItem(editor, { dueDate: event.target.value || null })
          }
        />
      </label>
      <label>
        <span>Priority</span>
        <select
          aria-label="Task priority"
          value={attrs.priority}
          onChange={(event) =>
            updateSelectedTaskItem(editor, {
              priority: event.target.value as (typeof TASK_PRIORITIES)[number],
            })
          }
        >
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>
      <span className="task-details-summary" aria-live="polite">
        {STATUS_LABELS[attrs.status]}, {PRIORITY_LABELS[attrs.priority]}
        {attrs.dueDate === null ? ", no due date" : `, due ${attrs.dueDate}`}
      </span>
    </fieldset>
  );
}
