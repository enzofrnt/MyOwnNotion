export type ClassNameValue = string | false | null | undefined;

export function classNames(...values: readonly ClassNameValue[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}
