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

const NATURES: Readonly<Record<string, string>> = {
  "item.create": "created",
  "item.rename": "renamed",
  "item.trash": "moved to trash",
  "item.restore": "restored from trash",
  "item.convert": "converted to another kind",
  "item.purge": "permanently deleted",
  "page.document.replace": "edited",
  "placement.move": "moved",
  "placement.add": "linked in a second place",
  "placement.remove": "unlinked from a place",
  "relationship.create": "related to another item",
  "relationship.delete": "unrelated from another item",
  "file.import": "uploaded",
  "file.content.replace": "replaced with new content",
  "revision.restore": "restored from history",
  // A conflict resolution. Named as what it is rather than as an edit, because
  // it is the one entry where two lines of work rejoined, and an owner looking
  // for that moment must be able to find it.
  "document.resolve-conflict": "resolved a conflict",
};

export function describeChangeNature(commandType: string): string {
  return NATURES[commandType] ?? "changed";
}
