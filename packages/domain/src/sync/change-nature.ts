/**
 * What a change was, in the owner's words (T037, FR-022).
 *
 * A history has to say the *nature* of a change, and a command name is not that.
 * `page.document.replace` describes how the server was asked; "edited" describes
 * what happened. The owner reading their own history is not debugging a protocol.
 *
 * Total by construction: an unrecognised command yields "changed" rather than
 * leaking the identifier. A command added later then reads as vague instead of
 * as machinery, and vague is the failure worth having — the alternative puts an
 * internal name in front of someone who has no way to interpret it.
 */

/**
 * One phrase per command this repository owns.
 *
 * Kept in step with `COMMAND_TYPES` by a test that walks the list and refuses the
 * fallback, which is how three mistakes here were found: two invented names for
 * commands that do not exist (`placement.add`, `relationship.delete`) and two
 * real commands with no phrase at all. Every entry for a favourited or offline
 * item would have read "changed" — accurate, and useless to the person looking
 * for what they did.
 */
const NATURES: Readonly<Record<string, string>> = {
  "item.create": "created",
  "item.rename": "renamed",
  "item.icon": "changed icon",
  "item.trash": "moved to trash",
  "item.restore": "restored from trash",
  "item.convert": "converted to another kind",
  "item.favourite": "marked as a favourite",
  "item.offline": "marked to keep on this device",
  "page.document.replace": "edited",
  "page-operations.updated": "edited",
  "placement.move": "moved",
  "placement.remove": "unlinked from a place",
  "file.placement.add": "attached to a page",
  "relationship.create": "related to another item",
  "relationship.remove": "unrelated from another item",
  "file.import": "uploaded",
  "revision.restore": "restored from history",
  "database.create": "created a database",
  "database.definition.replace": "changed database structure",
  "database.definition.resolve-conflict": "resolved a database structure conflict",
  "database.entry.create": "created a database entry",
  "database.entry.values.replace": "edited database properties",
  "database.entry.values.resolve-conflict": "resolved a database property conflict",
  // A conflict resolution. Named as what it is rather than as an edit, because
  // it is the one entry where two lines of work rejoined, and an owner looking
  // for that moment must be able to find it.
  "document.resolve-conflict": "resolved a conflict",
};

export function describeChangeNature(commandType: string): string {
  return NATURES[commandType] ?? "changed";
}
