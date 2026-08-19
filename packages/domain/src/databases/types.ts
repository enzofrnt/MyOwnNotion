import type { Uuid } from "../ids/uuid.ts";

export const DATABASE_DEFINITION_FORMAT = "myownnotion.database-definition+json" as const;
export const DATABASE_ENTRY_VALUES_FORMAT = "myownnotion.database-entry-values+json" as const;
export const DATABASE_FORMAT_VERSION = 1 as const;

export const DATABASE_PROPERTY_TYPES = [
  "title",
  "text",
  "number",
  "date",
  "status",
  "select",
  "multi-select",
  "checkbox",
  "relation",
] as const;
export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];
export type DatabaseObjectState = "active" | "retired";
export type EmptyPropertyConfig = Readonly<Record<string, never>>;

export interface PropertyOption {
  readonly id: Uuid;
  readonly label: string;
  readonly positionKey: string;
  readonly tone: string;
  readonly state: DatabaseObjectState;
}

interface DatabasePropertyBase {
  readonly id: Uuid;
  readonly name: string;
  readonly positionKey: string;
  readonly state: DatabaseObjectState;
}

export type DatabaseProperty =
  | (DatabasePropertyBase & {
      readonly type: "title" | "text" | "number" | "checkbox";
      readonly config: EmptyPropertyConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "date";
      readonly config: { readonly mode: "date" | "instant" };
    })
  | (DatabasePropertyBase & {
      readonly type: "status" | "select" | "multi-select";
      readonly config: { readonly options: readonly PropertyOption[] };
    })
  | (DatabasePropertyBase & {
      readonly type: "relation";
      readonly config: { readonly cardinality: "one" | "many" };
    });

export type TextPropertyValue = { readonly kind: "text"; readonly value: string };
export type NumberPropertyValue = { readonly kind: "number"; readonly decimal: string };
export type CivilDatePropertyValue = { readonly kind: "date"; readonly date: string };
export type InstantPropertyValue = { readonly kind: "instant"; readonly instant: string };
export type StatusPropertyValue = { readonly kind: "status"; readonly optionId: Uuid };
export type SelectPropertyValue = { readonly kind: "select"; readonly optionId: Uuid };
export type MultiSelectPropertyValue = {
  readonly kind: "multi-select";
  readonly optionIds: readonly Uuid[];
};
export type CheckboxPropertyValue = { readonly kind: "checkbox"; readonly checked: boolean };

export type NonRelationPropertyValue =
  | TextPropertyValue
  | NumberPropertyValue
  | CivilDatePropertyValue
  | InstantPropertyValue
  | StatusPropertyValue
  | SelectPropertyValue
  | MultiSelectPropertyValue
  | CheckboxPropertyValue;

export interface PreservedValue {
  readonly propertyId: Uuid;
  readonly sourceType: DatabasePropertyType;
  readonly value: unknown;
  readonly preservedAtRevisionId: Uuid;
  readonly reason: "incompatible-conversion" | "retired-property" | "retired-option";
}

export interface EntryValues {
  readonly format: typeof DATABASE_ENTRY_VALUES_FORMAT;
  readonly formatVersion: typeof DATABASE_FORMAT_VERSION;
  readonly databaseId: Uuid;
  readonly entryId: Uuid;
  readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
  readonly preserved: readonly PreservedValue[];
}

export type RelationTargets = Readonly<Record<Uuid, readonly Uuid[]>>;

export const DATABASE_VIEW_TYPES = ["table", "board", "gallery", "list", "calendar"] as const;
export type DatabaseViewType = (typeof DATABASE_VIEW_TYPES)[number];

export interface ViewPropertyPresentation {
  readonly propertyId: Uuid;
  readonly visible: boolean;
  readonly positionKey: string;
  readonly width?: number;
}

export const FILTER_OPERATORS = [
  "equals",
  "not-equals",
  "is-empty",
  "is-not-empty",
  "contains",
  "not-contains",
  "before",
  "after",
  "between",
  "less-than",
  "greater-than",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export type DatabaseFilterOperand =
  | NonRelationPropertyValue
  | { readonly kind: "relation"; readonly targetIds: readonly Uuid[] }
  | {
      readonly kind: "date-range";
      readonly from: CivilDatePropertyValue;
      readonly to: CivilDatePropertyValue;
    }
  | {
      readonly kind: "instant-range";
      readonly from: InstantPropertyValue;
      readonly to: InstantPropertyValue;
    };

export interface FilterCriterion {
  readonly id: Uuid;
  readonly propertyId: Uuid;
  readonly operator: FilterOperator;
  /** Validated against the referenced property before evaluation. */
  readonly operand?: DatabaseFilterOperand;
}

export interface FilterSet {
  readonly mode: "all" | "any";
  readonly criteria: readonly FilterCriterion[];
}

export interface SortCriterion {
  readonly propertyId: Uuid;
  readonly direction: "ascending" | "descending";
  readonly missing: "first" | "last";
}

export interface GroupCriterion {
  readonly propertyId: Uuid;
}

interface DatabaseViewBase {
  readonly id: Uuid;
  readonly name: string;
  readonly positionKey: string;
  readonly state: DatabaseObjectState;
  readonly properties: readonly ViewPropertyPresentation[];
  readonly filter: FilterSet;
  readonly sorts: readonly SortCriterion[];
  readonly group: GroupCriterion | null;
}

export type DatabaseView =
  | (DatabaseViewBase & {
      readonly type: "table";
      readonly options: {
        readonly density: "compact" | "comfortable";
        readonly freezeTitle: boolean;
      };
    })
  | (DatabaseViewBase & {
      readonly type: "board";
      readonly options: {
        readonly axisPropertyId: Uuid;
        readonly columnOrder: readonly Uuid[];
        readonly collapsedColumnIds: readonly Uuid[];
      };
    })
  | (DatabaseViewBase & {
      readonly type: "gallery";
      readonly options: {
        readonly cardPropertyIds: readonly Uuid[];
        readonly preview: "none" | "page" | "first-safe-file";
      };
    })
  | (DatabaseViewBase & {
      readonly type: "list";
      readonly options: {
        readonly density: "compact" | "comfortable";
        readonly secondaryPropertyIds: readonly Uuid[];
      };
    })
  | (DatabaseViewBase & {
      readonly type: "calendar";
      readonly options: {
        readonly datePropertyId: Uuid;
        readonly initialMode: "month";
      };
    });

export interface TaskRoleMapping {
  readonly statusPropertyId: Uuid;
  readonly dueDatePropertyId: Uuid | null;
  readonly priorityPropertyId: Uuid | null;
}

export interface DatabaseDefinition {
  readonly format: typeof DATABASE_DEFINITION_FORMAT;
  readonly formatVersion: typeof DATABASE_FORMAT_VERSION;
  readonly databaseId: Uuid;
  readonly properties: readonly DatabaseProperty[];
  readonly views: readonly DatabaseView[];
  readonly taskRoles: TaskRoleMapping | null;
}

export type DefinitionImpactReason =
  | "property-retired"
  | "property-type-changed"
  | "option-retired"
  | "task-role-invalidated";

export interface DefinitionImpact {
  readonly destructive: boolean;
  readonly affectedEntryCount: number;
  readonly affectedValueCount: number;
  readonly reasons: readonly DefinitionImpactReason[];
  readonly impactDigest: string;
}

export interface DatabaseQueryEntry {
  readonly entryId: Uuid;
  readonly title: string;
  readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
  readonly relationTargets: RelationTargets;
}

export interface EvaluatedDatabaseGroup {
  readonly id: string;
  readonly entryIds: readonly Uuid[];
}

export interface EvaluatedDatabaseView {
  readonly rows: readonly DatabaseQueryEntry[];
  readonly groups: readonly EvaluatedDatabaseGroup[];
}

export type DatabaseMergeConflictReason =
  | "divergent-edit"
  | "delete-edit"
  | "type-value-incompatible"
  | "definition-missing";

export interface DatabaseMergeConflict {
  readonly path: string;
  readonly reason: DatabaseMergeConflictReason;
}

export type DatabaseMergeOutcome<T> =
  | { readonly kind: "merged"; readonly value: T }
  | {
      readonly kind: "needs-owner";
      readonly conflicts: readonly DatabaseMergeConflict[];
      readonly ancestor: T;
      readonly local: T;
      readonly remote: T;
    };
