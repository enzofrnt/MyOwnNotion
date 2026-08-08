import {
  generateUuidV7,
  isTaskCalendarDate,
  isUuid,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskItemAttributes,
  type TaskPriority,
  type TaskStatus,
  type Uuid,
} from "@myownnotion/domain";
import type { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const taskMetadataPluginKey = new PluginKey("task-item-metadata");

export type TaskMetadataPatch = Readonly<
  Partial<Pick<TaskItemAttributes, "status" | "dueDate" | "priority">>
>;

function isTaskStatus(value: unknown): value is TaskStatus {
  return (TASK_STATUSES as readonly unknown[]).includes(value);
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return (TASK_PRIORITIES as readonly unknown[]).includes(value);
}

export function normalizeTaskItemAttributes(
  attrs: Readonly<Record<string, unknown>>,
  idFactory: () => Uuid = generateUuidV7,
  seenTaskIds: Set<string> = new Set(),
): TaskItemAttributes {
  const checked = attrs["checked"] === true;
  let taskId =
    isUuid(attrs["taskId"]) && !seenTaskIds.has(attrs["taskId"]) ? attrs["taskId"] : idFactory();
  while (seenTaskIds.has(taskId)) {
    taskId = idFactory();
  }
  seenTaskIds.add(taskId);

  const suppliedStatus = isTaskStatus(attrs["status"])
    ? attrs["status"]
    : checked
      ? "completed"
      : "todo";
  const status = checked ? "completed" : suppliedStatus === "completed" ? "todo" : suppliedStatus;
  return {
    checked: status === "completed",
    taskId,
    status,
    dueDate:
      attrs["dueDate"] === null || isTaskCalendarDate(attrs["dueDate"]) ? attrs["dueDate"] : null,
    priority: isTaskPriority(attrs["priority"]) ? attrs["priority"] : "none",
  };
}

export function applyTaskMetadata(
  attrs: TaskItemAttributes,
  patch: TaskMetadataPatch,
): TaskItemAttributes | null {
  if (patch.status !== undefined && !isTaskStatus(patch.status)) {
    return null;
  }
  if (patch.priority !== undefined && !isTaskPriority(patch.priority)) {
    return null;
  }
  if (patch.dueDate !== undefined && patch.dueDate !== null && !isTaskCalendarDate(patch.dueDate)) {
    return null;
  }
  const status = patch.status ?? attrs.status;
  return {
    ...attrs,
    ...patch,
    status,
    checked: status === "completed",
  };
}

export function taskRenderAttributes(attrs: TaskItemAttributes): Readonly<Record<string, string>> {
  return {
    "data-task-id": attrs.taskId,
    "data-task-status": attrs.status,
    ...(attrs.dueDate === null ? {} : { "data-task-due-date": attrs.dueDate }),
    "data-task-priority": attrs.priority,
  };
}

function attributesEqual(
  left: Readonly<Record<string, unknown>>,
  right: TaskItemAttributes,
): boolean {
  return (
    left["checked"] === right.checked &&
    left["taskId"] === right.taskId &&
    left["status"] === right.status &&
    left["dueDate"] === right.dueDate &&
    left["priority"] === right.priority
  );
}

function repairTaskItems(document: ProseMirrorNode, transaction: Transaction): boolean {
  const seenTaskIds = new Set<string>();
  let changed = false;
  document.descendants((node, position) => {
    if (node.type.name !== "taskItem") {
      return;
    }
    const normalized = normalizeTaskItemAttributes(node.attrs, generateUuidV7, seenTaskIds);
    if (!attributesEqual(node.attrs, normalized)) {
      transaction.setNodeMarkup(position, undefined, normalized);
      changed = true;
    }
  });
  return changed;
}

/** Upgrades legacy/missing task attributes before an explicit save. */
export function upgradeEditorTaskItems(editor: Editor): boolean {
  const transaction = editor.state.tr;
  if (!repairTaskItems(editor.state.doc, transaction)) {
    return false;
  }
  editor.view.dispatch(transaction);
  return true;
}

export interface SelectedTaskItem {
  readonly position: number;
  readonly attrs: TaskItemAttributes;
}

export function findSelectedTaskItem(editor: Editor): SelectedTaskItem | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "taskItem") {
      continue;
    }
    const attrs = normalizeTaskItemAttributes(node.attrs, generateUuidV7, new Set());
    if (!isUuid(node.attrs["taskId"])) {
      return null;
    }
    return { position: $from.before(depth), attrs };
  }
  return null;
}

export function updateSelectedTaskItem(editor: Editor, patch: TaskMetadataPatch): boolean {
  const selected = findSelectedTaskItem(editor);
  if (selected === null) {
    return false;
  }
  const next = applyTaskMetadata(selected.attrs, patch);
  if (next === null) {
    return false;
  }
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setNodeMarkup(selected.position, undefined, next);
      return true;
    })
    .run();
}

export const TaskItemWithMetadata = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-task-id"),
        renderHTML: (attributes) =>
          typeof attributes["taskId"] === "string" ? { "data-task-id": attributes["taskId"] } : {},
      },
      status: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-task-status"),
        renderHTML: (attributes) =>
          typeof attributes["status"] === "string"
            ? { "data-task-status": attributes["status"] }
            : {},
      },
      dueDate: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-task-due-date"),
        renderHTML: (attributes) =>
          typeof attributes["dueDate"] === "string"
            ? { "data-task-due-date": attributes["dueDate"] }
            : {},
      },
      priority: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-task-priority"),
        renderHTML: (attributes) =>
          typeof attributes["priority"] === "string"
            ? { "data-task-priority": attributes["priority"] }
            : {},
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: taskMetadataPluginKey,
        appendTransaction: (transactions, _oldState, state) => {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }
          const transaction = state.tr;
          return repairTaskItems(state.doc, transaction) ? transaction : null;
        },
      }),
    ];
  },
});
