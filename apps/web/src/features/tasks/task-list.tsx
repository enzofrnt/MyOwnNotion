import type { TaskProjection, Uuid } from "@myownnotion/domain";

const STATUS_LABELS = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
} as const;

const PRIORITY_LABELS = {
  none: "No priority",
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
} as const;

export function TaskList({
  tasks,
  onOpenTask,
}: {
  readonly tasks: readonly TaskProjection[];
  readonly onOpenTask: (sourceItemId: Uuid, taskId: Uuid) => void;
}) {
  return (
    <ul className="task-result-list" aria-label="Task list results" data-testid="task-list">
      {tasks.map((task) => (
        <li
          key={task.taskId}
          className="task-result"
          data-task-id={task.taskId}
          data-status={task.status}
          data-priority={task.priority}
        >
          <button
            type="button"
            className="task-result-open"
            aria-label={`Open task ${task.title || "Untitled task"} in ${task.sourceName}`}
            onClick={() => onOpenTask(task.sourceItemId, task.taskId)}
          >
            <span className="task-result-title">{task.title || "Untitled task"}</span>
            <span className="task-result-source">{task.sourceName}</span>
          </button>
          <span className="task-badge" data-kind="status">
            {STATUS_LABELS[task.status]}
          </span>
          <span className="task-badge" data-kind="priority">
            {PRIORITY_LABELS[task.priority]}
          </span>
          <span className="task-result-date">
            {task.dueDate === null ? "No due date" : `Due ${task.dueDate}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
