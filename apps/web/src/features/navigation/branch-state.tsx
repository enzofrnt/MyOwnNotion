/**
 * What a branch says when it has nothing to show (T052, US3, FR-015).
 *
 * Four states, and the requirement is that they be *distinguishable*: an owner
 * looking at a branch with no rows under it must be able to tell which of these
 * is true, because the right response differs for each.
 *
 *   - **loading** — wait
 *   - **empty** — put something in it
 *   - **unavailable offline** — it exists, this device has not fetched it
 *   - **error** — something went wrong, and here is what
 *
 * The rule that makes this worth a component: **a branch with no rows and no
 * explanation is a defect, not a rendering state.** Blank space says "empty" to
 * an owner regardless of which of the four is actually true, and the two that
 * are not empty are the ones where being wrong costs something — an owner who
 * reads "unavailable offline" as "empty" concludes their notes are gone.
 */

export type BranchStateKind = "loading" | "empty" | "offline" | "error";

const MESSAGES: Record<BranchStateKind, string> = {
  loading: "Loading…",
  empty: "Nothing in here yet.",
  // Names the situation and its remedy in one line: the content exists, this
  // device simply has not seen it.
  offline: "Not available on this device yet — reconnect to load what is in here.",
  error: "This could not be loaded.",
};

export function BranchState({
  kind,
  detail,
}: {
  readonly kind: BranchStateKind;
  /** For `error`, what went wrong, when there is something useful to say. */
  readonly detail?: string;
}) {
  return (
    <p
      className="branch-state"
      data-testid={`branch-state-${kind}`}
      data-state={kind}
      // Loading is announced as busy rather than as a message, so assistive
      // technology says "busy" instead of reading a placeholder as content.
      {...(kind === "loading" ? { "aria-busy": true } : {})}
      role={kind === "error" ? "alert" : "status"}
    >
      {MESSAGES[kind]}
      {kind === "error" && detail !== undefined ? ` ${detail}` : null}
    </p>
  );
}
