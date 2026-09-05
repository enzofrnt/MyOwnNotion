/** Stable safe CLI categories; detailed native/SQL errors never leave the host boundary. */
export class FullRestoreRefusal extends Error {
  override readonly name = "FullRestoreRefusal";
}
