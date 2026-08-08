import {
  groupTaskProjectionsByStatus,
  type TaskProjection,
  type TaskStatus,
  type Uuid,
} from "@myownnotion/domain";

const COLUMNS: ReadonlyArray<{ readonly status: TaskStatus; readonly label: string }> = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "completed", label: "Completed" },
  { status: "cancelled", label: "Cancelled" },
];

export function TaskBoard({
  tasks,
  onOpenTask,
}: {
  readonly tasks: readonly TaskProjection[];
  readonly onOpenTask: (sourceItemId: Uuid, taskId: Uuid) => void;
}) {
  const groups = groupTaskProjectionsByStatus(tasks);
  return (
    <section className="task-board" aria-label="Task status board" data-testid="task-board">
      {COLUMNS.map(({ status, label }) => (
        <section
          className="task-board-column"
          aria-labelledby={`task-column-${status}`}
          key={status}
        >
          <h3 id={`task-column-${status}`}>
            {label} <span>{groups[status].length} tasks</span>
          </h3>
          <ul>
            {groups[status].map((task) => (
              <li key={task.taskId} data-task-id={task.taskId} data-priority={task.priority}>
                <button
                  type="button"
                  aria-label={`Open task ${task.title || "Untitled task"} in ${task.sourceName}`}
                  onClick={() => onOpenTask(task.sourceItemId, task.taskId)}
                >
                  <strong>{task.title || "Untitled task"}</strong>
                  <span>{task.sourceName}</span>
                  <span>
                    {task.priority === "none" ? "No priority" : `${task.priority} priority`}
                  </span>
                  <span>{task.dueDate === null ? "No due date" : `Due ${task.dueDate}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
