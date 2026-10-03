export interface TextPosition {
  line: number;
  ch: number;
}

export interface TextRange {
  from: number;
  to: number;
}

export interface SelectionRules {
  list: boolean;
  heading: boolean;
  sentence: boolean;
  code: boolean;
  latex: boolean;
  whitespace: boolean;
  punctuation: boolean;
  pairs: boolean;
  token: boolean;
  line: boolean;
}

export interface SelectionState {
  anchor: number;
  head: number;
}

// Structural steps are on by default; the fine-grained in-line steps are opt-in.
const DEFAULT_RULES: SelectionRules = {
  list: true,
  heading: true,
  sentence: true,
  code: true,
  latex: true,
  whitespace: false,
  punctuation: false,
  pairs: false,
  token: false,
  line: false
};

export const DEFAULT_SENTENCE_MARKERS = ".!?。！？";

const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const LIST_MARKER = /^([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]+|$)/u;
const FENCE_MARKER = /^\s{0,3}(`{3,}|~{3,})/u;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+|$)/u;
const LATEX_BLOCK_START = /^\s*\\(?:begin\{([^}]+)\}|\[)/u;
const LATEX_BLOCK_END = /^\s*\\(?:end\{([^}]+)\}|\])/u;
const LATEX_INLINE_DELIMITERS = ["$$", "\\(", "\\[", "$", "\\begin{"];
// Characters that may close a sentence after its terminal marker, e.g. `."` or `!)`.
const SENTENCE_CLOSERS = new Set([")", "]", "\"", "'", "”", "’", "»", "」", "』", "）", "*", "_"]);
const TAB_WIDTH = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isPunctuationOrSymbol(character: string): boolean {
  return PUNCTUATION.test(character);
}

function isWhitespace(character: string): boolean {
  return WHITESPACE.test(character);
}

function isInlineWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}

function isWord(character: string): boolean {
  return WORD.test(character);
}

function isAllowedBoundaryCharacter(character: string, rules: SelectionRules): boolean {
  if (isPunctuationOrSymbol(character)) return rules.punctuation;
  if (isInlineWhitespace(character)) return rules.whitespace;
  return false;
}

function lineNumberAt(text: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

interface Line {
  start: number;
  end: number;
  text: string;
}

function getLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;

  while (start <= text.length) {
    const end = text.indexOf("\n", start);
    const actualEnd = end === -1 ? text.length : end;
    lines.push({ start, end: actualEnd, text: text.slice(start, actualEnd) });
    if (end === -1) break;
    start = end + 1;
  }

  return lines;
}

function isBlankLine(text: string): boolean {
  return /^\s*$/u.test(text);
}

function indentWidth(lineText: string): number {
  let width = 0;
  for (const character of lineText) {
    if (character === " ") width += 1;
    else if (character === "\t") width += TAB_WIDTH - (width % TAB_WIDTH);
    else break;
  }
  return width;
}

function trimOuterWhitespace(text: string, range: TextRange): TextRange {
  let from = range.from;
  let to = range.to;
  while (from < to && isWhitespace(text[from] ?? "")) from += 1;
  while (to > from && isWhitespace(text[to - 1] ?? "")) to -= 1;
  return { from, to };
}

function rangeContains(outer: TextRange, inner: TextRange): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function normalizeRange(range: TextRange, textLength: number): TextRange {
  return {
    from: clamp(Math.min(range.from, range.to), 0, textLength),
    to: clamp(Math.max(range.from, range.to), 0, textLength)
  };
}

/** Line-level facts about a note, computed once per expansion. */
interface MarkdownDocument {
  text: string;
  lines: Line[];
  /** Fenced code blocks as inclusive line-index spans. */
  fences: Array<{ first: number; last: number }>;
  inFence: boolean[];
  headingLevels: Array<number | null>;
}

function parseDocument(text: string): MarkdownDocument {
  const lines = getLines(text);
  const fences: Array<{ first: number; last: number }> = [];
  const inFence = lines.map(() => false);
  let open: { first: number; character: string; length: number } | null = null;

  lines.forEach((line, index) => {
    const match = line.text.match(FENCE_MARKER);
    if (open) {
      inFence[index] = true;
      if (match && match[1][0] === open.character && match[1].length >= open.length) {
        fences.push({ first: open.first, last: index });
        open = null;
      }
    } else if (match) {
      inFence[index] = true;
      open = { first: index, character: match[1][0], length: match[1].length };
    }
  });
  if (open) fences.push({ first: (open as { first: number }).first, last: lines.length - 1 });

  const headingLevels = lines.map((line, index) => {
    if (inFence[index]) return null;
    const match = line.text.match(HEADING);
    return match ? match[1].length : null;
  });

  return { text, lines, fences, inFence, headingLevels };
}

function lineRange(doc: MarkdownDocument, first: number, last = first): TextRange {
  return { from: doc.lines[first].start, to: doc.lines[last].end };
}

// ---------------------------------------------------------------------------
// Headings

function headingSection(doc: MarkdownDocument, index: number): TextRange {
  const level = doc.headingLevels[index] ?? 0;
  let last = index;
  for (let next = index + 1; next < doc.lines.length; next += 1) {
    const nextLevel = doc.headingLevels[next];
    if (nextLevel !== null && nextLevel <= level) break;
    last = next;
  }
  return lineRange(doc, index, last);
}

/** The section of the nearest heading at or above `index`, then each parent section outward. */
function headingLadder(doc: MarkdownDocument, index: number): TextRange[] {
  let heading = -1;
  for (let lineIndex = index; lineIndex >= 0; lineIndex -= 1) {
    if (doc.headingLevels[lineIndex] !== null) {
      heading = lineIndex;
      break;
    }
  }
  if (heading === -1) return [];

  const ranges = [headingSection(doc, heading)];
  let level = doc.headingLevels[heading] ?? 0;
  for (let lineIndex = heading - 1; lineIndex >= 0 && level > 1; lineIndex -= 1) {
    const candidate = doc.headingLevels[lineIndex];
    if (candidate !== null && candidate < level) {
      ranges.push(headingSection(doc, lineIndex));
      level = candidate;
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Lists

function isListLine(doc: MarkdownDocument, index: number): boolean {
  return !doc.inFence[index] && LIST_MARKER.test(doc.lines[index].text);
}

/**
 * The list item a line belongs to: the line itself when it is a bullet, otherwise the nearest
 * shallower bullet above it (an indented continuation line, fenced block or nested paragraph).
 */
function owningListItem(doc: MarkdownDocument, index: number): number | null {
  if (isListLine(doc, index)) return index;
  if (isBlankLine(doc.lines[index].text) || doc.headingLevels[index] !== null) return null;
  return shallowerListItemAbove(doc, index, indentWidth(doc.lines[index].text));
}

function shallowerListItemAbove(doc: MarkdownDocument, index: number, indent: number): number | null {
  for (let lineIndex = index - 1; lineIndex >= 0; lineIndex -= 1) {
    const text = doc.lines[lineIndex].text;
    if (isBlankLine(text)) continue;
    if (doc.headingLevels[lineIndex] !== null) return null;
    if (indentWidth(text) >= indent) continue;
    return isListLine(doc, lineIndex) ? lineIndex : null;
  }
  return null;
}

/** A bullet plus every following line indented deeper than it (children, continuations). */
function listItemSubtree(doc: MarkdownDocument, index: number): TextRange {
  const indent = indentWidth(doc.lines[index].text);
  let last = index;
  for (let next = index + 1; next < doc.lines.length; next += 1) {
    const text = doc.lines[next].text;
    if (isBlankLine(text)) continue;
    if (doc.headingLevels[next] !== null || indentWidth(text) <= indent) break;
    last = next;
  }
  return lineRange(doc, index, last);
}

/** Every line of the list containing the top-level bullet `root`, bridging blank lines. */
function wholeList(doc: MarkdownDocument, root: number): TextRange {
  const indent = indentWidth(doc.lines[root].text);
  const belongs = (lineIndex: number): boolean => {
    const text = doc.lines[lineIndex].text;
    if (doc.headingLevels[lineIndex] !== null) return false;
    const width = indentWidth(text);
    return isListLine(doc, lineIndex) ? width >= indent : width > indent;
  };

  let first = root;
  for (let lineIndex = root - 1; lineIndex >= 0; lineIndex -= 1) {
    if (isBlankLine(doc.lines[lineIndex].text)) continue;
    if (!belongs(lineIndex)) break;
    first = lineIndex;
  }
  let last = root;
  for (let lineIndex = root + 1; lineIndex < doc.lines.length; lineIndex += 1) {
    if (isBlankLine(doc.lines[lineIndex].text)) continue;
    if (!belongs(lineIndex)) break;
    last = lineIndex;
  }
  return lineRange(doc, first, last);
}

/** Bullet line → bullet with children → each parent with children → whole list. */
function listLadder(doc: MarkdownDocument, item: number): TextRange[] {
  const ranges = [lineRange(doc, item), listItemSubtree(doc, item)];
  let root = item;
  let parent = shallowerListItemAbove(doc, item, indentWidth(doc.lines[item].text));
  while (parent !== null) {
    ranges.push(listItemSubtree(doc, parent));
    root = parent;
    parent = shallowerListItemAbove(doc, parent, indentWidth(doc.lines[parent].text));
  }
  ranges.push(wholeList(doc, root));
  return ranges;
}

// ---------------------------------------------------------------------------
// Paragraphs and sentences

/** Paragraphs stop at blank lines, headings, bullets and the edge of a code block. */
function isParagraphBoundary(doc: MarkdownDocument, index: number, fenced: boolean, rules: SelectionRules): boolean {
  return isBlankLine(doc.lines[index].text)
    || doc.headingLevels[index] !== null
    || (rules.list && isListLine(doc, index))
    || doc.inFence[index] !== fenced;
}

function paragraphRange(doc: MarkdownDocument, index: number, rules: SelectionRules): TextRange | null {
  const fenced = doc.inFence[index];
  if (isParagraphBoundary(doc, index, fenced, rules)) return null;
  let first = index;
  let last = index;
  while (first > 0 && !isParagraphBoundary(doc, first - 1, fenced, rules)) first -= 1;
  while (last + 1 < doc.lines.length && !isParagraphBoundary(doc, last + 1, fenced, rules)) last += 1;
  return lineRange(doc, first, last);
}

/**
 * Splits a paragraph into sentences. A sentence ends after a run of marker characters (plus any
 * closing quotes/brackets) followed by whitespace or the paragraph end. Full-width markers such as
 * `。` end a sentence without needing a following space.
 */
export function sentenceRanges(text: string, paragraph: TextRange, markers: string): TextRange[] {
  const markerSet = new Set(Array.from(markers));
  const ranges: TextRange[] = [];
  const push = (from: number, to: number): void => {
    const trimmed = trimOuterWhitespace(text, { from, to });
    if (trimmed.from < trimmed.to) ranges.push(trimmed);
  };

  let start = paragraph.from;
  let index = paragraph.from;
  while (index < paragraph.to) {
    const character = text[index];
    if (!markerSet.has(character)) {
      index += 1;
      continue;
    }
    let end = index + 1;
    let fullWidth = character.charCodeAt(0) > 0x2000;
    while (end < paragraph.to && markerSet.has(text[end])) {
      if (text.charCodeAt(end) > 0x2000) fullWidth = true;
      end += 1;
    }
    while (end < paragraph.to && SENTENCE_CLOSERS.has(text[end])) end += 1;
    if (fullWidth || end >= paragraph.to || isWhitespace(text[end])) {
      push(start, end);
      start = end;
    }
    index = end;
  }
  push(start, paragraph.to);
  return ranges;
}

// ---------------------------------------------------------------------------
// In-line steps (word, boundaries, pairs, tokens)

function expandWord(text: string, offset: number): TextRange | null {
  if (text.length === 0) return null;
  offset = clamp(offset, 0, text.length);
  const atLineEnd = offset === text.length || text[offset] === "\n";
  if ((atLineEnd || !isWord(text[offset])) && offset > 0 && text[offset - 1] !== "\n" && (atLineEnd || isWord(text[offset - 1]))) {
    offset -= 1;
  }
  const current = text[offset];
  if (!current || current === "\n") return null;

  if (isWord(current)) {
    let from = offset;
    let to = offset;
    while (from > 0 && isWord(text[from - 1])) from -= 1;
    while (to < text.length && isWord(text[to])) to += 1;
    return { from, to };
  }
  return { from: offset, to: offset + 1 };
}

function expandBoundaryRun(text: string, range: TextRange, rules: SelectionRules): TextRange | null {
  if (range.from >= range.to) return null;
  for (let index = range.from; index < range.to; index += 1) {
    if (!isAllowedBoundaryCharacter(text[index], rules)) return null;
  }
  return expandAdjacentBoundaries(text, range, rules);
}

function expandAdjacentBoundaries(text: string, range: TextRange, rules: SelectionRules): TextRange | null {
  if (range.from >= range.to) return null;
  let from = range.from;
  let to = range.to;
  while (from > 0 && isAllowedBoundaryCharacter(text[from - 1], rules)) from -= 1;
  while (to < text.length && isAllowedBoundaryCharacter(text[to], rules)) to += 1;
  return from === range.from && to === range.to ? null : { from, to };
}

function expandToken(text: string, range: TextRange, rules: SelectionRules): TextRange | null {
  const candidate = trimOuterWhitespace(text, range);
  if (candidate.from >= candidate.to) return null;
  let from = candidate.from;
  let to = candidate.to;
  while (from > 0 && !isWhitespace(text[from - 1]) && (rules.punctuation || !isPunctuationOrSymbol(text[from - 1]))) from -= 1;
  while (to < text.length && !isWhitespace(text[to]) && (rules.punctuation || !isPunctuationOrSymbol(text[to]))) to += 1;
  return { from, to };
}

/** Bracket pairs (and, optionally, Markdown emphasis/code runs) within `scope` enclosing `range`. */
function surroundingPairRanges(text: string, range: TextRange, scope: TextRange, includeMarkdownDelimiters: boolean): TextRange[] {
  const ranges: TextRange[] = [];
  const stack: Array<{ opening: string; index: number }> = [];
  const closingToOpening: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

  for (let index = scope.from; index < scope.to; index += 1) {
    if (text[index - 1] === "\\") continue;
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") {
      stack.push({ opening: character, index });
      continue;
    }
    const opening = closingToOpening[character];
    if (!opening) continue;
    for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
      if (stack[stackIndex].opening !== opening) continue;
      const pair = { from: stack[stackIndex].index, to: index + 1 };
      if (rangeContains(pair, range)) ranges.push(pair);
      stack.splice(stackIndex, 1);
      break;
    }
  }

  if (!includeMarkdownDelimiters) return ranges;

  // Delimiter runs (`**`, `_`, `` ` ``, `~~`) pair with the next run of the same character and length.
  const runs: Array<{ character: string; length: number; index: number }> = [];
  for (let index = scope.from; index < scope.to; index += 1) {
    const character = text[index];
    if (!"`*_~".includes(character) || text[index - 1] === "\\") continue;
    let end = index;
    while (end < scope.to && text[end] === character) end += 1;
    const length = end - index;
    const intraword = character === "_" && isWord(text[index - 1] ?? "") && isWord(text[end] ?? "");
    if (!intraword) {
      let match = runs.length - 1;
      while (match >= 0 && (runs[match].character !== character || runs[match].length !== length)) match -= 1;
      if (match === -1) {
        runs.push({ character, length, index });
      } else {
        const pair = { from: runs[match].index, to: end };
        if (rangeContains(pair, range)) ranges.push(pair);
        runs.splice(match);
      }
    }
    index = end - 1;
  }
  return ranges;
}

function quotedRanges(text: string, range: TextRange, scope: TextRange): TextRange[] {
  const ranges: TextRange[] = [];
  for (const quote of ["\"", "'"]) {
    let opening = -1;
    for (let index = scope.from; index < scope.to; index += 1) {
      if (text[index] !== quote || text[index - 1] === "\\") continue;
      if (opening === -1) {
        opening = index;
        continue;
      }
      const candidate = { from: opening, to: index + 1 };
      if (rangeContains(candidate, range)) ranges.push(candidate);
      opening = -1;
    }
  }
  return ranges;
}

/** The optional fine-grained steps, each behind its own rule. */
function inlineSteps(text: string, range: TextRange, scope: TextRange, rules: SelectionRules): Array<TextRange | null> {
  if (range.from === range.to) return [];
  return [
    expandAdjacentBoundaries(text, range, rules),
    expandBoundaryRun(text, range, rules),
    ...(rules.pairs ? surroundingPairRanges(text, range, scope, true) : []),
    rules.token ? expandToken(text, range, rules) : null
  ];
}

// ---------------------------------------------------------------------------
// LaTeX

function parseLatexRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const stack: Array<{ start: number; environment: string | null }> = [];

  for (const line of getLines(text)) {
    const startMatch = line.text.match(LATEX_BLOCK_START);
    if (startMatch) {
      stack.push({ start: line.start, environment: startMatch[1] ?? null });
      continue;
    }

    const endMatch = line.text.match(LATEX_BLOCK_END);
    if (endMatch && stack.length > 0) {
      const opening = stack.pop();
      if (opening && (!opening.environment || !endMatch[1] || opening.environment === endMatch[1])) {
        ranges.push({ from: opening.start, to: line.end });
      }
    }
  }

  while (stack.length > 0) {
    const opening = stack.pop();
    if (opening) ranges.push({ from: opening.start, to: text.length });
  }

  const inlinePattern = /\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|(?<!\$)\$(?!\$)[^\n$]+(?<!\$)\$(?!\$)/gu;
  for (const match of text.matchAll(inlinePattern)) {
    const from = match.index ?? 0;
    ranges.push({ from, to: from + match[0].length });
  }

  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function findContainingLatexRange(text: string, range: TextRange): TextRange | null {
  return parseLatexRanges(text).find((candidate) => rangeContains(candidate, range)) ?? null;
}

// ---------------------------------------------------------------------------

export function getSelectionRange(selection: SelectionState): TextRange {
  return {
    from: Math.min(selection.anchor, selection.head),
    to: Math.max(selection.anchor, selection.head)
  };
}

/**
 * Returns the next larger range around the selection. Every structural level that applies is
 * collected as a candidate, and the smallest one strictly enclosing the selection wins, so levels
 * chain naturally: list/paragraph/code → heading section → parent sections → whole note.
 */
export function expandSelection(
  text: string,
  selection: SelectionState,
  inputRules: Partial<SelectionRules> = DEFAULT_RULES,
  sentenceMarkers = DEFAULT_SENTENCE_MARKERS
): TextRange {
  const rules = { ...DEFAULT_RULES, ...inputRules };
  const current = normalizeRange(getSelectionRange(selection), text.length);
  const doc = parseDocument(text);
  const lineIndex = lineNumberAt(text, current.from);
  const line = lineRange(doc, lineIndex);
  const candidates: Array<TextRange | null> = [];

  if (current.from === current.to) candidates.push(expandWord(text, current.from));

  const fence = rules.code
    ? doc.fences.find((candidate) => rangeContains(lineRange(doc, candidate.first, candidate.last), current)) ?? null
    : null;
  const latex = rules.latex && !fence ? findContainingLatexRange(text, current) : null;
  // The line whose structure (list item, heading, paragraph) the selection sits in.
  const structureLine = fence ? fence.first : lineIndex;

  if (fence) {
    const fenceRange = lineRange(doc, fence.first, fence.last);
    candidates.push(...surroundingPairRanges(text, current, fenceRange, false), ...quotedRanges(text, current, fenceRange));
    candidates.push(line, fenceRange);
  } else if (latex) {
    candidates.push(...surroundingPairRanges(text, current, latex, false), latex);
  }

  const listItem = rules.list ? owningListItem(doc, structureLine) : null;
  if (listItem !== null) {
    if (!fence && structureLine === listItem) candidates.push(...inlineSteps(text, current, line, rules));
    candidates.push(...listLadder(doc, listItem));
  } else if (!fence && doc.headingLevels[structureLine] !== null) {
    candidates.push(...inlineSteps(text, current, line, rules), line);
  } else if (!fence) {
    const paragraph = paragraphRange(doc, structureLine, rules);
    if (paragraph) {
      candidates.push(...inlineSteps(text, current, paragraph, rules));
      if (rules.sentence) candidates.push(...sentenceRanges(text, paragraph, sentenceMarkers));
      if (rules.line) candidates.push(line);
      candidates.push(paragraph);
    }
  }

  if (rules.heading) candidates.push(...headingLadder(doc, structureLine));
  candidates.push({ from: 0, to: text.length });

  let best: TextRange | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const range = normalizeRange(candidate, text.length);
    if (!rangeContains(range, current) || (range.from === current.from && range.to === current.to)) continue;
    if (!best || range.to - range.from < best.to - best.from) best = range;
  }
  return best ?? current;
}

export function shrinkSelection(history: SelectionState[], current: SelectionState): SelectionState {
  const currentRange = getSelectionRange(current);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index];
    const candidateRange = getSelectionRange(candidate);
    if (candidateRange.from !== currentRange.from || candidateRange.to !== currentRange.to) {
      return candidate;
    }
  }
  return { anchor: current.head, head: current.head };
}

export function positionToOffset(text: string, position: TextPosition): number {
  const lines = getLines(text);
  const line = clamp(position.line, 0, Math.max(0, lines.length - 1));
  const target = lines[line];
  return target.start + clamp(position.ch, 0, target.end - target.start);
}

export function offsetToPosition(text: string, offset: number): TextPosition {
  const safeOffset = clamp(offset, 0, text.length);
  const lines = getLines(text);
  const line = lineNumberAt(text, safeOffset);
  return { line, ch: safeOffset - lines[line].start };
}

export interface HeadingLine {
  /** Zero-based line index. */
  line: number;
  level: number;
  /** Heading text without the leading `#`s. */
  text: string;
}

/** Every heading in the note, in order, ignoring `#` lines inside code blocks. */
export function listHeadings(text: string): HeadingLine[] {
  const doc = parseDocument(text);
  const headings: HeadingLine[] = [];
  doc.headingLevels.forEach((level, line) => {
    if (level === null) return;
    headings.push({ line, level, text: doc.lines[line].text.replace(HEADING, "").replace(/\s+#+\s*$/u, "").trim() });
  });
  return headings;
}

export function getDefaultSelectionRules(): SelectionRules {
  return { ...DEFAULT_RULES };
}

export const latexInlineDelimiters = LATEX_INLINE_DELIMITERS;
