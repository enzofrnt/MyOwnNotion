export type PageOperationServiceProblemCode =
  | "page-operations.activation-stale"
  | "page-operations.dependencies-missing"
  | "page-operations.digest-mismatch"
  | "page-operations.projection-invalid"
  | "page-operations.schema-unsupported"
  | "page-operations.update-id-reused"
  | "item.not-found";

export class PageOperationServiceError extends Error {
  constructor(
    readonly code: PageOperationServiceProblemCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PageOperationServiceError";
  }
}
