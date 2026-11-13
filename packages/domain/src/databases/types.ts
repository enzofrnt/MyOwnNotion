import type { Uuid } from "../ids/uuid.ts";

export const DATABASE_DEFINITION_FORMAT = "myownnotion.database-definition+json" as const;
export const DATABASE_ENTRY_VALUES_FORMAT = "myownnotion.database-entry-values+json" as const;
export const DATABASE_FORMAT_VERSION = 1 as const;
/** Feature 029 separates the owned source from each container's saved views. */
export const DATABASE_SOURCE_FORMAT = "myownnotion.database-source+json" as const;
export const DATABASE_PRESENTATION_FORMAT = "myownnotion.database-presentation+json" as const;

/** Stable bridge for pre-029 commands that did not supply a separate source ID. */
export function ownedSourceIdFromItemId(ownerItemId: Uuid): Uuid {
  const lastDigit = ownerItemId.at(-1);
  if (lastDigit === undefined) throw new TypeError("Owner identity is empty");
  return `${ownerItemId.slice(0, -1)}${(Number.parseInt(lastDigit, 16) ^ 1).toString(16)}` as Uuid;
}

/** A stable placement when an older entry-create caller omitted one. */
export function databaseEntryPlacementId(entryId: Uuid): Uuid {
  const lastDigit = entryId.at(-1);
  if (lastDigit === undefined) throw new TypeError("Entry identity is empty");
  return `${entryId.slice(0, -1)}${(Number.parseInt(lastDigit, 16) ^ 2).toString(16)}` as Uuid;
}

export const DATABASE_PROPERTY_TYPES = [
  "title",
  "text",
  "number",
  "date",
  "status",
  "select",
  "multi-select",
  "checkbox",
  "url",
  "email",
  "phone",
  "created-time",
  "last-edited-time",
  "formula",
  "files",
  "rollup",
  "unique-id",
  "place",
  "relation",
] as const;
export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];
export type DatabaseObjectState = "active" | "retired";
export type EmptyPropertyConfig = Readonly<Record<string, never>>;

/** Notion-compatible number formats. Currency formats map to ISO 4217 below. */
export const NUMBER_FORMATS = [
  "number",
  "number_with_separators",
  "percent",
  "dollar",
  "australian_dollar",
  "canadian_dollar",
  "singapore_dollar",
  "euro",
  "pound",
  "yen",
  "ruble",
  "rupee",
  "won",
  "yuan",
  "real",
  "lira",
  "rupiah",
  "franc",
  "hong_kong_dollar",
  "new_zealand_dollar",
  "krona",
  "norwegian_krone",
  "mexican_peso",
  "rand",
  "new_taiwan_dollar",
  "danish_krone",
  "zloty",
  "baht",
  "forint",
  "koruna",
  "shekel",
  "chilean_peso",
  "philippine_peso",
  "dirham",
  "colombian_peso",
  "riyal",
  "ringgit",
  "leu",
  "argentine_peso",
  "uruguayan_peso",
  "peruvian_sol",
  "vietnamese_dong",
  "pakistani_rupee",
  "nigerian_naira",
  "bitcoin",
] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const NUMBER_FORMAT_CURRENCY: Readonly<Record<NumberFormat, string | null>> = {
  number: null,
  number_with_separators: null,
  percent: null,
  dollar: "USD",
  australian_dollar: "AUD",
  canadian_dollar: "CAD",
  singapore_dollar: "SGD",
  euro: "EUR",
  pound: "GBP",
  yen: "JPY",
  ruble: "RUB",
  rupee: "INR",
  won: "KRW",
  yuan: "CNY",
  real: "BRL",
  lira: "TRY",
  rupiah: "IDR",
  franc: "CHF",
  hong_kong_dollar: "HKD",
  new_zealand_dollar: "NZD",
  krona: "SEK",
  norwegian_krone: "NOK",
  mexican_peso: "MXN",
  rand: "ZAR",
  new_taiwan_dollar: "TWD",
  danish_krone: "DKK",
  zloty: "PLN",
  baht: "THB",
  forint: "HUF",
  koruna: "CZK",
  shekel: "ILS",
  chilean_peso: "CLP",
  philippine_peso: "PHP",
  dirham: "AED",
  colombian_peso: "COP",
  riyal: "SAR",
  ringgit: "MYR",
  leu: "RON",
  argentine_peso: "ARS",
  uruguayan_peso: "UYU",
  peruvian_sol: "PEN",
  vietnamese_dong: "VND",
  pakistani_rupee: "PKR",
  nigerian_naira: "NGN",
  bitcoin: "BTC",
};

export const ROLLUP_FUNCTIONS = [
  "count",
  "count_values",
  "empty",
  "not_empty",
  "unique",
  "show_unique",
  "percent_empty",
  "percent_not_empty",
  "sum",
  "average",
  "median",
  "min",
  "max",
  "range",
  "earliest_date",
  "latest_date",
  "date_range",
  "checked",
  "unchecked",
  "percent_checked",
  "percent_unchecked",
  "count_per_group",
  "percent_per_group",
  "show_original",
] as const;
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

export const DATE_FORMATS = [
  "full",
  "short",
  "month-day-year",
  "day-month-year",
  "year-month-day",
  "relative",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const TIME_FORMATS = ["hidden", "12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
export interface DateDisplayConfig {
  /** Absent on legacy properties; reads as the Notion defaults. */
  readonly dateFormat?: DateFormat;
  readonly timeFormat?: TimeFormat;
}
export interface UniqueIdPropertyConfig {
  /** Notion displays PREFIX-NUMBER; empty/absent keeps the bare number. */
  readonly prefix?: string;
}

export interface DatePropertyConfig extends DateDisplayConfig {
  readonly mode: "date" | "instant";
}
export const DEFAULT_DATE_FORMAT: DateFormat = "full";
export const DEFAULT_TIME_FORMAT: TimeFormat = "12h";

export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === "string" && (DATE_FORMATS as readonly string[]).includes(value);
}
export function isTimeFormat(value: unknown): value is TimeFormat {
  return typeof value === "string" && (TIME_FORMATS as readonly string[]).includes(value);
}

export type NumberDecimals = "default" | 0 | 1 | 2 | 3 | 4 | 5;
export type NumberDisplay = "number" | "bar" | "ring";
export interface NumberPropertyConfig {
  readonly format: NumberFormat;
  readonly decimals: NumberDecimals;
  readonly display: NumberDisplay;
}
export const DEFAULT_NUMBER_CONFIG: NumberPropertyConfig = {
  format: "number",
  decimals: "default",
  display: "number",
};

export function isNumberFormat(value: unknown): value is NumberFormat {
  return typeof value === "string" && (NUMBER_FORMATS as readonly string[]).includes(value);
}

export function isNumberPropertyConfig(value: unknown): value is NumberPropertyConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;
  return (
    Object.keys(config).length === 3 &&
    isNumberFormat(config["format"]) &&
    (config["decimals"] === "default" ||
      (typeof config["decimals"] === "number" &&
        Number.isInteger(config["decimals"]) &&
        config["decimals"] >= 0 &&
        config["decimals"] <= 5)) &&
    (config["display"] === "number" || config["display"] === "bar" || config["display"] === "ring")
  );
}

export interface PropertyOption {
  readonly id: Uuid;
  readonly label: string;
  readonly positionKey: string;
  readonly tone: string;
  readonly state: DatabaseObjectState;
}

export const STATUS_GROUPS = ["todo", "in-progress", "complete"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];
export interface StatusOption extends PropertyOption {
  /** Missing on legacy/select-converted options; reads as "todo". */
  readonly group?: StatusGroup;
}
export interface StatusPropertyConfig {
  readonly options: readonly StatusOption[];
  /** Absent on legacy properties; reads as the first active option. */
  readonly defaultOptionId?: Uuid;
}
export function isStatusGroup(value: unknown): value is StatusGroup {
  return typeof value === "string" && (STATUS_GROUPS as readonly string[]).includes(value);
}
/** Infers a Notion group for legacy options created before groups existed. */
export function inferStatusGroup(label: string): StatusGroup {
  const normalized = label.toLocaleLowerCase();
  if (/termin|done|complete/u.test(normalized)) return "complete";
  if (/cours|progress|doing/u.test(normalized)) return "in-progress";
  return "todo";
}
export const STATUS_GROUP_LABELS: Readonly<Record<StatusGroup, string>> = {
  todo: "À faire",
  "in-progress": "En cours",
  complete: "Terminé",
};

interface DatabasePropertyBase {
  readonly id: Uuid;
  readonly name: string;
  /** Optional source-owned mark; absent/null keeps the property type symbol. */
  readonly icon?: string | null;
  readonly positionKey: string;
  readonly state: DatabaseObjectState;
}

export type DatabaseProperty =
  | (DatabasePropertyBase & {
      readonly type: "title" | "text" | "checkbox" | "url" | "email" | "phone" | "files";
      readonly config: EmptyPropertyConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "unique-id";
      /** Empty config is the legacy shape and reads as no prefix. */
      readonly config: EmptyPropertyConfig | UniqueIdPropertyConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "created-time" | "last-edited-time";
      /** Empty config is the legacy shape and reads as the Notion defaults. */
      readonly config: EmptyPropertyConfig | DateDisplayConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "number";
      /** Empty config is the legacy/default shape and reads as DEFAULT_NUMBER_CONFIG. */
      readonly config: EmptyPropertyConfig | NumberPropertyConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "formula";
      readonly config: { readonly expression: string };
    })
  | (DatabasePropertyBase & {
      readonly type: "rollup";
      readonly config: {
        readonly relationPropertyId: Uuid;
        readonly targetPropertyId?: Uuid;
        readonly aggregate: RollupFunction;
      };
    })
  | (DatabasePropertyBase & {
      readonly type: "date";
      readonly config: DatePropertyConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "status";
      readonly config: StatusPropertyConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "select" | "multi-select";
      readonly config: { readonly options: readonly PropertyOption[] };
    })
  | (DatabasePropertyBase & {
      readonly type: "place";
      readonly config: EmptyPropertyConfig;
    })
  | (DatabasePropertyBase & {
      readonly type: "relation";
      readonly config: {
        readonly cardinality: "one" | "many";
        /** Canonical data source, never its host item or a linked view. Absent on legacy relations. */
        readonly targetSourceId?: Uuid;
        /**
         * The other property of a two-way pair. Both sides carry one, pointing
         * at each other; the edges themselves stay single-truth on the entry
         * that owns the property.
         */
        readonly reciprocalPropertyId?: Uuid;
        /**
         * `true` on the property whose links are stored on the partner entry.
         * Absent on the canonical side, which owns the edges itself.
         */
        readonly inverseEdges?: boolean;
      };
    });

export type TextPropertyValue = { readonly kind: "text"; readonly value: string };
export type NumberPropertyValue = { readonly kind: "number"; readonly decimal: string };
export type CivilDatePropertyValue = {
  readonly kind: "date";
  readonly date: string;
  readonly endDate?: string;
};
export type InstantPropertyValue = {
  readonly kind: "instant";
  readonly instant: string;
  readonly endInstant?: string;
};
export type StatusPropertyValue = { readonly kind: "status"; readonly optionId: Uuid };
export type SelectPropertyValue = { readonly kind: "select"; readonly optionId: Uuid };
export type MultiSelectPropertyValue = {
  readonly kind: "multi-select";
  readonly optionIds: readonly Uuid[];
};
export type CheckboxPropertyValue = { readonly kind: "checkbox"; readonly checked: boolean };
export type FilesPropertyValue = {
  readonly kind: "files";
  readonly fileIds: readonly Uuid[];
  /** Notion external files; optional on legacy values. */
  readonly externalUrls?: readonly string[];
};
export type PlacePropertyValue = {
  readonly kind: "place";
  readonly placeId: string;
  readonly name: string;
  readonly address: string | null;
  readonly latitude: number;
  readonly longitude: number;
};

export type NonRelationPropertyValue =
  | TextPropertyValue
  | NumberPropertyValue
  | CivilDatePropertyValue
  | InstantPropertyValue
  | StatusPropertyValue
  | SelectPropertyValue
  | MultiSelectPropertyValue
  | CheckboxPropertyValue
  | FilesPropertyValue
  | PlacePropertyValue;

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

export const DATABASE_VIEW_TYPES = [
  "table",
  "board",
  "gallery",
  "list",
  "calendar",
  "map",
] as const;
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
  /** Chosen mark. Absent or null keeps the icon of the view format. */
  readonly icon?: string | null;
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
    })
  | (DatabaseViewBase & {
      readonly type: "map";
      readonly options: {
        readonly placePropertyId: Uuid;
      };
    });

/** A saved view always names its source, even when that source is owned elsewhere. */
export type SourcedDatabaseView = DatabaseView & { readonly sourceId: Uuid };

export interface DatabaseSourceDefinition {
  readonly format: typeof DATABASE_SOURCE_FORMAT;
  readonly formatVersion: typeof DATABASE_FORMAT_VERSION;
  readonly sourceId: Uuid;
  readonly ownerItemId: Uuid;
  readonly name: string;
  readonly properties: readonly DatabaseProperty[];
  readonly taskRoles: TaskRoleMapping | null;
}

export interface DatabasePresentationDefinition {
  readonly format: typeof DATABASE_PRESENTATION_FORMAT;
  readonly formatVersion: typeof DATABASE_FORMAT_VERSION;
  /** A database owner or a linked-view item; never the source identity. */
  readonly containerItemId: Uuid;
  readonly views: readonly SourcedDatabaseView[];
}

export interface TaskRoleMapping {
  readonly statusPropertyId: Uuid;
  readonly dueDatePropertyId: Uuid | null;
  readonly priorityPropertyId: Uuid | null;
}

export type TaskRole = "status" | "dueDate" | "priority";
export type TaskStatusValue = StatusPropertyValue | SelectPropertyValue;
export type TaskDueDateValue = CivilDatePropertyValue | InstantPropertyValue;

export interface TaskSemanticField<T extends NonRelationPropertyValue> {
  /** Stable reference to the canonical property; no task value is persisted here. */
  readonly propertyId: Uuid;
  readonly value: T | null;
}

/** A transient semantic projection over one ordinary database entry. */
export interface TaskSemanticProjection {
  readonly entryId: Uuid;
  readonly status: TaskSemanticField<TaskStatusValue>;
  readonly dueDate: TaskSemanticField<TaskDueDateValue> | null;
  readonly priority: TaskSemanticField<TaskStatusValue> | null;
}

export interface DatabaseDefinition {
  readonly format: typeof DATABASE_DEFINITION_FORMAT;
  readonly formatVersion: typeof DATABASE_FORMAT_VERSION;
  readonly databaseId: Uuid;
  /** Private source metadata, independent of the page displaying it. */
  readonly name?: string;
  /** Absent only for legacy sources displayed on their former host page. */
  readonly embeddings?: readonly DatabaseEmbedding[];
  readonly properties: readonly DatabaseProperty[];
  readonly views: readonly DatabaseView[];
  readonly taskRoles: TaskRoleMapping | null;
}

export interface DatabaseEmbedding {
  readonly id: Uuid;
  readonly hostPageId: Uuid;
  readonly state: DatabaseObjectState;
  readonly views: readonly DatabaseView[];
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
  readonly entryNumber?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
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
  /** Matching rows before an optional first-page top-K limit is applied. */
  readonly totalCount: number;
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

/** Reads a number property config, falling back to the Notion defaults. */
export function numberConfigOf(property: DatabaseProperty): NumberPropertyConfig {
  if (property.type !== "number") return DEFAULT_NUMBER_CONFIG;
  const config = property.config;
  return isNumberPropertyConfig(config) ? config : DEFAULT_NUMBER_CONFIG;
}

/** Reads date display settings with Notion-compatible defaults. */
export function dateConfigOf(property: DatabaseProperty): {
  readonly mode: "date" | "instant";
  readonly dateFormat: DateFormat;
  readonly timeFormat: TimeFormat;
} {
  if (property.type !== "date") {
    return { mode: "date", dateFormat: DEFAULT_DATE_FORMAT, timeFormat: DEFAULT_TIME_FORMAT };
  }
  const display = dateDisplayConfigOf(property);
  return { mode: property.config.mode, ...display };
}

/** Reads the display settings for date, created time and last edited time. */
export function dateDisplayConfigOf(property: DatabaseProperty): {
  readonly dateFormat: DateFormat;
  readonly timeFormat: TimeFormat;
} {
  const config =
    property.type === "date" ||
    property.type === "created-time" ||
    property.type === "last-edited-time"
      ? (property.config as DateDisplayConfig)
      : null;
  return {
    dateFormat: isDateFormat(config?.dateFormat) ? config.dateFormat : DEFAULT_DATE_FORMAT,
    timeFormat: isTimeFormat(config?.timeFormat) ? config.timeFormat : DEFAULT_TIME_FORMAT,
  };
}

/** Reads the configured default status option, falling back to the first active option. */
export function statusDefaultOptionId(property: DatabaseProperty): Uuid | null {
  if (property.type !== "status") return null;
  const configured = property.config.options.find(
    (option) => option.id === property.config.defaultOptionId && option.state === "active",
  );
  return (
    configured?.id ??
    property.config.options.find((option) => option.state === "active")?.id ??
    null
  );
}

/** Prefix for a unique ID, or an empty string when none is configured. */
export function uniqueIdPrefixOf(property: DatabaseProperty): string {
  if (property.type !== "unique-id") return "";
  const prefix = (property.config as UniqueIdPropertyConfig).prefix;
  return typeof prefix === "string" ? prefix : "";
}

export function isRollupFunction(value: unknown): value is RollupFunction {
  return typeof value === "string" && (ROLLUP_FUNCTIONS as readonly string[]).includes(value);
}
