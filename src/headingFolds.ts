import type { HeadingLine } from "./selection";

/**
 * Folding in the heading list. Headings are identified by line; `folded` holds the lines of the
 * headings whose subheadings are hidden.
 */

/** Index just past the last subheading of `headings[index]`. */
function subtreeEnd(headings: HeadingLine[], index: number): number {
  let end = index + 1;
  while (end < headings.length && headings[end].level > headings[index].level) end += 1;
  return end;
}

/** Number of subheadings (at any depth) under the heading at `index`. */
export function subheadingCount(headings: HeadingLine[], index: number): number {
  return subtreeEnd(headings, index) - index - 1;
}

function parentIndex(headings: HeadingLine[], index: number): number {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (headings[candidate].level < headings[index].level) return candidate;
  }
  return -1;
}

/** The headings left visible once every folded heading's subheadings are hidden. */
export function visibleHeadings(headings: HeadingLine[], folded: ReadonlySet<number>): HeadingLine[] {
  const visible: HeadingLine[] = [];
  let index = 0;
  while (index < headings.length) {
    visible.push(headings[index]);
    index = folded.has(headings[index].line) ? subtreeEnd(headings, index) : index + 1;
  }
  return visible;
}

/**
 * Fold more on the heading at `line`: fold it if it has visible subheadings; otherwise (no
 * subheadings, or already folded) fold its parent and move the highlight there.
 * Returns the line to highlight afterwards.
 */
export function foldMore(headings: HeadingLine[], folded: Set<number>, line: number): number {
  const index = headings.findIndex((heading) => heading.line === line);
  if (index === -1) return line;
  if (subheadingCount(headings, index) > 0 && !folded.has(line)) {
    folded.add(line);
    return line;
  }
  const parent = parentIndex(headings, index);
  if (parent === -1) return line;
  folded.add(headings[parent].line);
  return headings[parent].line;
}

/**
 * Fold less on the heading at `line`: unfold it if folded; otherwise unfold its folded
 * subheadings that are currently visible, one level at a time.
 */
export function foldLess(headings: HeadingLine[], folded: Set<number>, line: number): void {
  const index = headings.findIndex((heading) => heading.line === line);
  if (index === -1) return;
  if (folded.delete(line)) return;
  const end = subtreeEnd(headings, index);
  const visible = new Set(visibleHeadings(headings, folded).map((heading) => heading.line));
  for (let child = index + 1; child < end; child += 1) {
    const childLine = headings[child].line;
    if (visible.has(childLine)) folded.delete(childLine);
  }
}

/**
 * Fold all: fold every heading that has subheadings, leaving the top level. Returns the line to
 * highlight: the visible heading that contains `line`.
 */
export function foldAll(headings: HeadingLine[], folded: Set<number>, line: number): number {
  headings.forEach((heading, index) => {
    if (subheadingCount(headings, index) > 0) folded.add(heading.line);
  });
  return visibleAncestor(headings, folded, line);
}

/** Unfold all: show every heading. */
export function unfoldAll(folded: Set<number>): void {
  folded.clear();
}

/** The heading at `line` if visible, otherwise its nearest visible ancestor. */
export function visibleAncestor(headings: HeadingLine[], folded: ReadonlySet<number>, line: number): number {
  const visible = new Set(visibleHeadings(headings, folded).map((heading) => heading.line));
  let index = headings.findIndex((heading) => heading.line === line);
  while (index !== -1 && !visible.has(headings[index].line)) index = parentIndex(headings, index);
  return index === -1 ? line : headings[index].line;
}
