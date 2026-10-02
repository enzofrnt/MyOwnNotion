import {
  collectDocumentIdsV3,
  type TableCellV3,
  type TableRowV3,
  type Uuid,
} from "@myownnotion/domain";
export function tableCellIdentities(cell: TableCellV3): Uuid[] {
  return [cell.id, ...(collectDocumentIdsV3({ blocks: cell.children ?? [] }) as Uuid[])];
}
export function tableRowIdentities(row: TableRowV3): Uuid[] {
  return [row.id, ...row.cells.flatMap(tableCellIdentities)];
}
