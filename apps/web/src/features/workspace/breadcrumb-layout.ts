/**
 * Which path segments stay visible when the path is wider than its row
 * (spec 022, FR-003/FR-004).
 *
 * Priority: the current item, then its parent, then the first ancestor, then
 * the remaining ancestors from the nearest to the farthest. Hidden segments
 * always form one contiguous block, so a single "…" can stand for them.
 */

export interface BreadcrumbLayoutInput {
  /** Measured width of each segment, root first. */
  readonly widths: readonly number[];
  /** Width of one separator glyph between two segments. */
  readonly separatorWidth: number;
  /** Width of the "…" control (it counts as one segment when shown). */
  readonly ellipsisWidth: number;
  /** Width available for the whole row. */
  readonly available: number;
}

export interface BreadcrumbLayout {
  /** Indexes rendered inline, ascending. */
  readonly visible: readonly number[];
  /** Indexes folded into the "…" menu, ascending. Empty when nothing is hidden. */
  readonly hidden: readonly number[];
}

function rowWidth(
  indexes: ReadonlySet<number>,
  input: BreadcrumbLayoutInput,
  withEllipsis: boolean,
): number {
  let segments = 0;
  let total = 0;
  for (const index of indexes) {
    segments += 1;
    total += input.widths[index] ?? 0;
  }
  if (withEllipsis) {
    segments += 1;
    total += input.ellipsisWidth;
  }
  return total + Math.max(0, segments - 1) * input.separatorWidth;
}

export function selectVisibleCrumbs(input: BreadcrumbLayoutInput): BreadcrumbLayout {
  const count = input.widths.length;
  const all = Array.from({ length: count }, (_, index) => index);
  if (count <= 2) return { visible: all, hidden: [] };
  if (rowWidth(new Set(all), input, false) <= input.available) {
    return { visible: all, hidden: [] };
  }

  const last = count - 1;
  const visible = new Set<number>([last]);
  const fits = (candidate: number): boolean => {
    const trial = new Set(visible);
    trial.add(candidate);
    // Once every other index is shown the ellipsis disappears again.
    const withEllipsis = trial.size < count;
    return rowWidth(trial, input, withEllipsis) <= input.available;
  };

  if (fits(last - 1)) visible.add(last - 1);
  // The root is the only non-suffix segment allowed; skipping it keeps the
  // hidden block contiguous whatever happens next.
  if (fits(0)) visible.add(0);
  // Then grow the suffix towards the root; stopping at the first miss keeps
  // the hidden block in one piece.
  for (let index = last - 2; index >= 1; index -= 1) {
    if (!fits(index)) break;
    visible.add(index);
  }

  const visibleSorted = [...visible].sort((left, right) => left - right);
  const hidden = all.filter((index) => !visible.has(index));
  return { visible: visibleSorted, hidden };
}
