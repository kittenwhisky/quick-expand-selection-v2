import { listHeadings, type HeadingLine, type TextRange } from "./selection";

export type InsertPosition = "append" | "prepend";
export type CursorAfterMove = "stay" | "follow";
export const DEFAULT_INSERT_TOGGLE_HOTKEY = "Alt+A";

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** A planned move. `changes` use offsets in the original text; the ranges use offsets after it. */
export interface MovePlan {
  changes: TextChange[];
  /** Where the moved text was taken from, collapsed, after the move. */
  removedAt: number;
  /** The moved text at its new location, after the move. */
  moved: TextRange;
}

interface Line {
  start: number;
  end: number;
  text: string;
}

function getLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n", start);
    lines.push({ start, end: end === -1 ? text.length : end, text: text.slice(start, end === -1 ? text.length : end) });
    if (end === -1) return lines;
    start = end + 1;
  }
}

function lineIndexAt(lines: Line[], offset: number): number {
  let index = 0;
  while (index + 1 < lines.length && lines[index + 1].start <= offset) index += 1;
  return index;
}

/**
 * True when the selection covers whole lines: it starts at a line start and ends at a line end
 * (or at the start of the following line).
 */
export function isWholeLineSelection(text: string, range: TextRange): boolean {
  if (range.from === range.to) return false;
  const lines = getLines(text);
  const first = lines[lineIndexAt(lines, range.from)];
  if (range.from !== first.start) return false;
  const last = lines[lineIndexAt(lines, range.to)];
  return range.to === last.end || range.to === last.start;
}

/** Headings the selection can be moved under: every heading not inside the selection itself. */
export function movableTargets(text: string, range: TextRange): HeadingLine[] {
  const lines = getLines(text);
  return listHeadings(text).filter(({ line }) => {
    const { start, end } = lines[line];
    return end < range.from || start >= range.to;
  });
}

/**
 * Plans moving the selection under the heading on line `headingLine`.
 * - `prepend`: directly below the heading line, above its existing content.
 * - `append`: after the last non-blank line of the heading's own text (before its first
 *   subheading); directly below the heading line if it has no text of its own.
 * Whole-line selections move as lines. A partial selection moves exactly the selected text, which
 * is placed on its own line.
 */
export function planMove(text: string, range: TextRange, headingLine: number, position: InsertPosition): MovePlan | null {
  if (range.from === range.to) return null;
  const lines = getLines(text);
  const headings = listHeadings(text);
  const heading = headings.find((candidate) => candidate.line === headingLine);
  if (!heading) return null;

  // What is removed, and the text that moves.
  let removeFrom: number;
  let removeTo: number;
  let moved: string;
  let removedLines: { first: number; last: number } | null = null;
  if (isWholeLineSelection(text, range)) {
    const first = lineIndexAt(lines, range.from);
    let last = lineIndexAt(lines, range.to);
    if (range.to === lines[last].start && last > first) last -= 1;
    if (headingLine >= first && headingLine <= last) return null;
    removedLines = { first, last };
    moved = lines.slice(first, last + 1).map((line) => line.text).join("\n");
    if (last + 1 < lines.length) {
      removeFrom = lines[first].start;
      removeTo = lines[last + 1].start;
    } else {
      removeFrom = first > 0 ? lines[first - 1].end : 0;
      removeTo = lines[last].end;
    }
  } else {
    removeFrom = range.from;
    removeTo = range.to;
    // The text gets its own line(s), so surrounding line breaks are not carried along.
    moved = text.slice(range.from, range.to).replace(/^\n+|\n+$/gu, "");
  }

  // Where it goes: the end of the heading line, or of the last line of the heading's own text.
  let anchorLine = headingLine;
  if (position === "append") {
    const nextHeading = headings.find((candidate) => candidate.line > headingLine);
    const sectionEnd = nextHeading ? nextHeading.line : lines.length;
    for (let line = headingLine + 1; line < sectionEnd; line += 1) {
      if (removedLines && line >= removedLines.first && line <= removedLines.last) continue;
      if (lines[line].text.trim() !== "") anchorLine = line;
    }
  }
  let insertAt = lines[anchorLine].end;
  // A partial selection can run through the anchor line's end; insert where the text is removed.
  if (insertAt > removeFrom && insertAt < removeTo) insertAt = removeFrom;

  const insert = `\n${moved}`;
  const removed = removeTo - removeFrom;
  const insertStart = insertAt <= removeFrom ? insertAt : insertAt - removed;
  const removedAt = insertAt <= removeFrom ? removeFrom + insert.length : removeFrom;

  return {
    changes: [
      { from: removeFrom, to: removeTo, insert: "" },
      { from: insertAt, to: insertAt, insert }
    ],
    removedAt,
    moved: { from: insertStart + 1, to: insertStart + 1 + moved.length }
  };
}

/** Applies non-overlapping changes given in original-text offsets. */
export function applyChanges(text: string, changes: TextChange[]): string {
  // Later changes first, so earlier offsets stay valid; at equal offsets the deletion goes first,
  // which places an insertion at a deletion's start before the deleted span.
  const ordered = [...changes].sort((left, right) => right.from - left.from || (left.insert === "" ? -1 : 1));
  let result = text;
  for (const change of ordered) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  return result;
}
