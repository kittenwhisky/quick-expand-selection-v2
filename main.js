'use strict';

var obsidian = require('obsidian');
var language = require('@codemirror/language');
var state = require('@codemirror/state');
var view = require('@codemirror/view');

const MODIFIER_ALIASES = {
    mod: "mod",
    ctrl: "ctrl",
    control: "ctrl",
    meta: "meta",
    cmd: "meta",
    command: "meta",
    win: "meta",
    alt: "alt",
    option: "alt",
    opt: "alt",
    shift: "shift"
};
/** Parses `Alt+A`-style text; returns null unless it is modifiers plus exactly one key. */
function parseHotkey(text) {
    const parts = text.split("+").map((part) => part.trim()).filter((part) => part.length > 0);
    if (parts.length === 0)
        return null;
    const hotkey = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: "" };
    for (const part of parts) {
        const modifier = MODIFIER_ALIASES[part.toLowerCase()];
        if (modifier) {
            hotkey[modifier] = true;
        }
        else if (hotkey.key) {
            return null;
        }
        else {
            hotkey.key = part.toLowerCase();
        }
    }
    return hotkey.key ? hotkey : null;
}
/**
 * Letters and digits are matched by physical key (`KeyA`, `Digit1`), because with Alt/Option held
 * macOS reports a different character (Option+A gives `å`).
 */
function matchesHotkey(hotkey, event, isMac) {
    const wantCtrl = hotkey.ctrl || (hotkey.mod && !isMac);
    const wantMeta = hotkey.meta || (hotkey.mod && isMac);
    if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== hotkey.alt || event.shiftKey !== hotkey.shift) {
        return false;
    }
    if (/^[a-z]$/u.test(hotkey.key))
        return event.code === `Key${hotkey.key.toUpperCase()}`;
    if (/^[0-9]$/u.test(hotkey.key))
        return event.code === `Digit${hotkey.key}`;
    return event.key.toLowerCase() === hotkey.key;
}
/** How the hotkey is shown to the user, e.g. `Alt+A` on Windows or `⌥A` on macOS. */
function formatHotkey(hotkey, isMac) {
    const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key.charAt(0).toUpperCase() + hotkey.key.slice(1);
    if (isMac) {
        return [
            hotkey.ctrl ? "⌃" : "",
            hotkey.alt ? "⌥" : "",
            hotkey.shift ? "⇧" : "",
            hotkey.meta || hotkey.mod ? "⌘" : "",
            key
        ].join("");
    }
    return [
        hotkey.ctrl || hotkey.mod ? "Ctrl" : "",
        hotkey.meta ? "Win" : "",
        hotkey.alt ? "Alt" : "",
        hotkey.shift ? "Shift" : "",
        key
    ].filter((part) => part.length > 0).join("+");
}

// Structural steps are on by default; the fine-grained in-line steps are opt-in.
const DEFAULT_RULES = {
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
const DEFAULT_SENTENCE_MARKERS = ".!?。！？";
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const LIST_MARKER = /^([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]+|$)/u;
const FENCE_MARKER = /^\s{0,3}(`{3,}|~{3,})/u;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+|$)/u;
const LATEX_BLOCK_START = /^\s*\\(?:begin\{([^}]+)\}|\[)/u;
const LATEX_BLOCK_END = /^\s*\\(?:end\{([^}]+)\}|\])/u;
// Characters that may close a sentence after its terminal marker, e.g. `."` or `!)`.
const SENTENCE_CLOSERS = new Set([")", "]", "\"", "'", "”", "’", "»", "」", "』", "）", "*", "_"]);
const TAB_WIDTH = 4;
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function isPunctuationOrSymbol(character) {
    return PUNCTUATION.test(character);
}
function isWhitespace(character) {
    return WHITESPACE.test(character);
}
function isInlineWhitespace(character) {
    return character === " " || character === "\t";
}
function isWord(character) {
    return WORD.test(character);
}
function isAllowedBoundaryCharacter(character, rules) {
    if (isPunctuationOrSymbol(character))
        return rules.punctuation;
    if (isInlineWhitespace(character))
        return rules.whitespace;
    return false;
}
function lineNumberAt(text, offset) {
    let line = 0;
    for (let index = 0; index < offset; index += 1) {
        if (text[index] === "\n")
            line += 1;
    }
    return line;
}
function getLines$1(text) {
    const lines = [];
    let start = 0;
    while (start <= text.length) {
        const end = text.indexOf("\n", start);
        const actualEnd = end === -1 ? text.length : end;
        lines.push({ start, end: actualEnd, text: text.slice(start, actualEnd) });
        if (end === -1)
            break;
        start = end + 1;
    }
    return lines;
}
function isBlankLine(text) {
    return /^\s*$/u.test(text);
}
function indentWidth(lineText) {
    let width = 0;
    for (const character of lineText) {
        if (character === " ")
            width += 1;
        else if (character === "\t")
            width += TAB_WIDTH - (width % TAB_WIDTH);
        else
            break;
    }
    return width;
}
function trimOuterWhitespace(text, range) {
    let from = range.from;
    let to = range.to;
    while (from < to && isWhitespace(text[from] ?? ""))
        from += 1;
    while (to > from && isWhitespace(text[to - 1] ?? ""))
        to -= 1;
    return { from, to };
}
function rangeContains(outer, inner) {
    return outer.from <= inner.from && outer.to >= inner.to;
}
function normalizeRange(range, textLength) {
    return {
        from: clamp(Math.min(range.from, range.to), 0, textLength),
        to: clamp(Math.max(range.from, range.to), 0, textLength)
    };
}
function parseDocument(text) {
    const lines = getLines$1(text);
    const fences = [];
    const inFence = lines.map(() => false);
    let open = null;
    lines.forEach((line, index) => {
        const match = line.text.match(FENCE_MARKER);
        if (open) {
            inFence[index] = true;
            if (match && match[1][0] === open.character && match[1].length >= open.length) {
                fences.push({ first: open.first, last: index });
                open = null;
            }
        }
        else if (match) {
            inFence[index] = true;
            open = { first: index, character: match[1][0], length: match[1].length };
        }
    });
    if (open)
        fences.push({ first: open.first, last: lines.length - 1 });
    const headingLevels = lines.map((line, index) => {
        if (inFence[index])
            return null;
        const match = line.text.match(HEADING);
        return match ? match[1].length : null;
    });
    return { text, lines, fences, inFence, headingLevels };
}
function lineRange(doc, first, last = first) {
    return { from: doc.lines[first].start, to: doc.lines[last].end };
}
// ---------------------------------------------------------------------------
// Headings
function headingSection(doc, index) {
    const level = doc.headingLevels[index] ?? 0;
    let last = index;
    for (let next = index + 1; next < doc.lines.length; next += 1) {
        const nextLevel = doc.headingLevels[next];
        if (nextLevel !== null && nextLevel <= level)
            break;
        last = next;
    }
    return lineRange(doc, index, last);
}
/** The section of the nearest heading at or above `index`, then each parent section outward. */
function headingLadder(doc, index) {
    let heading = -1;
    for (let lineIndex = index; lineIndex >= 0; lineIndex -= 1) {
        if (doc.headingLevels[lineIndex] !== null) {
            heading = lineIndex;
            break;
        }
    }
    if (heading === -1)
        return [];
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
function isListLine(doc, index) {
    return !doc.inFence[index] && LIST_MARKER.test(doc.lines[index].text);
}
/**
 * The list item a line belongs to: the line itself when it is a bullet, otherwise the nearest
 * shallower bullet above it (an indented continuation line, fenced block or nested paragraph).
 */
function owningListItem(doc, index) {
    if (isListLine(doc, index))
        return index;
    if (isBlankLine(doc.lines[index].text) || doc.headingLevels[index] !== null)
        return null;
    return shallowerListItemAbove(doc, index, indentWidth(doc.lines[index].text));
}
function shallowerListItemAbove(doc, index, indent) {
    for (let lineIndex = index - 1; lineIndex >= 0; lineIndex -= 1) {
        const text = doc.lines[lineIndex].text;
        if (isBlankLine(text))
            continue;
        if (doc.headingLevels[lineIndex] !== null)
            return null;
        if (indentWidth(text) >= indent)
            continue;
        return isListLine(doc, lineIndex) ? lineIndex : null;
    }
    return null;
}
/** A bullet plus every following line indented deeper than it (children, continuations). */
function listItemSubtree(doc, index) {
    const indent = indentWidth(doc.lines[index].text);
    let last = index;
    for (let next = index + 1; next < doc.lines.length; next += 1) {
        const text = doc.lines[next].text;
        if (isBlankLine(text))
            continue;
        if (doc.headingLevels[next] !== null || indentWidth(text) <= indent)
            break;
        last = next;
    }
    return lineRange(doc, index, last);
}
/** Every line of the list containing the top-level bullet `root`, bridging blank lines. */
function wholeList(doc, root) {
    const indent = indentWidth(doc.lines[root].text);
    const belongs = (lineIndex) => {
        const text = doc.lines[lineIndex].text;
        if (doc.headingLevels[lineIndex] !== null)
            return false;
        const width = indentWidth(text);
        return isListLine(doc, lineIndex) ? width >= indent : width > indent;
    };
    let first = root;
    for (let lineIndex = root - 1; lineIndex >= 0; lineIndex -= 1) {
        if (isBlankLine(doc.lines[lineIndex].text))
            continue;
        if (!belongs(lineIndex))
            break;
        first = lineIndex;
    }
    let last = root;
    for (let lineIndex = root + 1; lineIndex < doc.lines.length; lineIndex += 1) {
        if (isBlankLine(doc.lines[lineIndex].text))
            continue;
        if (!belongs(lineIndex))
            break;
        last = lineIndex;
    }
    return lineRange(doc, first, last);
}
/** Bullet line → bullet with children → each parent with children → whole list. */
function listLadder(doc, item) {
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
function isParagraphBoundary(doc, index, fenced, rules) {
    return isBlankLine(doc.lines[index].text)
        || doc.headingLevels[index] !== null
        || (rules.list && isListLine(doc, index))
        || doc.inFence[index] !== fenced;
}
function paragraphRange(doc, index, rules) {
    const fenced = doc.inFence[index];
    if (isParagraphBoundary(doc, index, fenced, rules))
        return null;
    let first = index;
    let last = index;
    while (first > 0 && !isParagraphBoundary(doc, first - 1, fenced, rules))
        first -= 1;
    while (last + 1 < doc.lines.length && !isParagraphBoundary(doc, last + 1, fenced, rules))
        last += 1;
    return lineRange(doc, first, last);
}
/**
 * Splits a paragraph into sentences. A sentence ends after a run of marker characters (plus any
 * closing quotes/brackets) followed by whitespace or the paragraph end. Full-width markers such as
 * `。` end a sentence without needing a following space.
 */
function sentenceRanges(text, paragraph, markers) {
    const markerSet = new Set(Array.from(markers));
    const ranges = [];
    const push = (from, to) => {
        const trimmed = trimOuterWhitespace(text, { from, to });
        if (trimmed.from < trimmed.to)
            ranges.push(trimmed);
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
            if (text.charCodeAt(end) > 0x2000)
                fullWidth = true;
            end += 1;
        }
        while (end < paragraph.to && SENTENCE_CLOSERS.has(text[end]))
            end += 1;
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
function expandWord(text, offset) {
    if (text.length === 0)
        return null;
    offset = clamp(offset, 0, text.length);
    const atLineEnd = offset === text.length || text[offset] === "\n";
    if ((atLineEnd || !isWord(text[offset])) && offset > 0 && text[offset - 1] !== "\n" && (atLineEnd || isWord(text[offset - 1]))) {
        offset -= 1;
    }
    const current = text[offset];
    if (!current || current === "\n")
        return null;
    if (isWord(current)) {
        let from = offset;
        let to = offset;
        while (from > 0 && isWord(text[from - 1]))
            from -= 1;
        while (to < text.length && isWord(text[to]))
            to += 1;
        return { from, to };
    }
    return { from: offset, to: offset + 1 };
}
function expandBoundaryRun(text, range, rules) {
    if (range.from >= range.to)
        return null;
    for (let index = range.from; index < range.to; index += 1) {
        if (!isAllowedBoundaryCharacter(text[index], rules))
            return null;
    }
    return expandAdjacentBoundaries(text, range, rules);
}
function expandAdjacentBoundaries(text, range, rules) {
    if (range.from >= range.to)
        return null;
    let from = range.from;
    let to = range.to;
    while (from > 0 && isAllowedBoundaryCharacter(text[from - 1], rules))
        from -= 1;
    while (to < text.length && isAllowedBoundaryCharacter(text[to], rules))
        to += 1;
    return from === range.from && to === range.to ? null : { from, to };
}
function expandToken(text, range, rules) {
    const candidate = trimOuterWhitespace(text, range);
    if (candidate.from >= candidate.to)
        return null;
    let from = candidate.from;
    let to = candidate.to;
    while (from > 0 && !isWhitespace(text[from - 1]) && (rules.punctuation || !isPunctuationOrSymbol(text[from - 1])))
        from -= 1;
    while (to < text.length && !isWhitespace(text[to]) && (rules.punctuation || !isPunctuationOrSymbol(text[to])))
        to += 1;
    return { from, to };
}
/** Bracket pairs (and, optionally, Markdown emphasis/code runs) within `scope` enclosing `range`. */
function surroundingPairRanges(text, range, scope, includeMarkdownDelimiters) {
    const ranges = [];
    const stack = [];
    const closingToOpening = { ")": "(", "]": "[", "}": "{" };
    for (let index = scope.from; index < scope.to; index += 1) {
        if (text[index - 1] === "\\")
            continue;
        const character = text[index];
        if (character === "(" || character === "[" || character === "{") {
            stack.push({ opening: character, index });
            continue;
        }
        const opening = closingToOpening[character];
        if (!opening)
            continue;
        for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
            if (stack[stackIndex].opening !== opening)
                continue;
            const pair = { from: stack[stackIndex].index, to: index + 1 };
            if (rangeContains(pair, range))
                ranges.push(pair);
            stack.splice(stackIndex, 1);
            break;
        }
    }
    if (!includeMarkdownDelimiters)
        return ranges;
    // Delimiter runs (`**`, `_`, `` ` ``, `~~`) pair with the next run of the same character and length.
    const runs = [];
    for (let index = scope.from; index < scope.to; index += 1) {
        const character = text[index];
        if (!"`*_~".includes(character) || text[index - 1] === "\\")
            continue;
        let end = index;
        while (end < scope.to && text[end] === character)
            end += 1;
        const length = end - index;
        const intraword = character === "_" && isWord(text[index - 1] ?? "") && isWord(text[end] ?? "");
        if (!intraword) {
            let match = runs.length - 1;
            while (match >= 0 && (runs[match].character !== character || runs[match].length !== length))
                match -= 1;
            if (match === -1) {
                runs.push({ character, length, index });
            }
            else {
                const pair = { from: runs[match].index, to: end };
                if (rangeContains(pair, range))
                    ranges.push(pair);
                runs.splice(match);
            }
        }
        index = end - 1;
    }
    return ranges;
}
function quotedRanges(text, range, scope) {
    const ranges = [];
    for (const quote of ["\"", "'"]) {
        let opening = -1;
        for (let index = scope.from; index < scope.to; index += 1) {
            if (text[index] !== quote || text[index - 1] === "\\")
                continue;
            if (opening === -1) {
                opening = index;
                continue;
            }
            const candidate = { from: opening, to: index + 1 };
            if (rangeContains(candidate, range))
                ranges.push(candidate);
            opening = -1;
        }
    }
    return ranges;
}
/** The optional fine-grained steps, each behind its own rule. */
function inlineSteps(text, range, scope, rules) {
    if (range.from === range.to)
        return [];
    return [
        expandAdjacentBoundaries(text, range, rules),
        expandBoundaryRun(text, range, rules),
        ...(rules.pairs ? surroundingPairRanges(text, range, scope, true) : []),
        rules.token ? expandToken(text, range, rules) : null
    ];
}
// ---------------------------------------------------------------------------
// LaTeX
function parseLatexRanges(text) {
    const ranges = [];
    const stack = [];
    for (const line of getLines$1(text)) {
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
        if (opening)
            ranges.push({ from: opening.start, to: text.length });
    }
    const inlinePattern = /\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|(?<!\$)\$(?!\$)[^\n$]+(?<!\$)\$(?!\$)/gu;
    for (const match of text.matchAll(inlinePattern)) {
        const from = match.index ?? 0;
        ranges.push({ from, to: from + match[0].length });
    }
    return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}
function findContainingLatexRange(text, range) {
    return parseLatexRanges(text).find((candidate) => rangeContains(candidate, range)) ?? null;
}
// ---------------------------------------------------------------------------
function getSelectionRange(selection) {
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
function expandSelection(text, selection, inputRules = DEFAULT_RULES, sentenceMarkers = DEFAULT_SENTENCE_MARKERS) {
    const rules = { ...DEFAULT_RULES, ...inputRules };
    const current = normalizeRange(getSelectionRange(selection), text.length);
    const doc = parseDocument(text);
    const lineIndex = lineNumberAt(text, current.from);
    const line = lineRange(doc, lineIndex);
    const candidates = [];
    if (current.from === current.to)
        candidates.push(expandWord(text, current.from));
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
    }
    else if (latex) {
        candidates.push(...surroundingPairRanges(text, current, latex, false), latex);
    }
    const listItem = rules.list ? owningListItem(doc, structureLine) : null;
    if (listItem !== null) {
        if (!fence && structureLine === listItem)
            candidates.push(...inlineSteps(text, current, line, rules));
        candidates.push(...listLadder(doc, listItem));
    }
    else if (!fence && doc.headingLevels[structureLine] !== null) {
        candidates.push(...inlineSteps(text, current, line, rules), line);
    }
    else if (!fence) {
        const paragraph = paragraphRange(doc, structureLine, rules);
        if (paragraph) {
            candidates.push(...inlineSteps(text, current, paragraph, rules));
            if (rules.sentence)
                candidates.push(...sentenceRanges(text, paragraph, sentenceMarkers));
            if (rules.line)
                candidates.push(line);
            candidates.push(paragraph);
        }
    }
    if (rules.heading)
        candidates.push(...headingLadder(doc, structureLine));
    candidates.push({ from: 0, to: text.length });
    let best = null;
    for (const candidate of candidates) {
        if (!candidate)
            continue;
        const range = normalizeRange(candidate, text.length);
        if (!rangeContains(range, current) || (range.from === current.from && range.to === current.to))
            continue;
        if (!best || range.to - range.from < best.to - best.from)
            best = range;
    }
    return best ?? current;
}
function shrinkSelection(history, current) {
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
function positionToOffset(text, position) {
    const lines = getLines$1(text);
    const line = clamp(position.line, 0, Math.max(0, lines.length - 1));
    const target = lines[line];
    return target.start + clamp(position.ch, 0, target.end - target.start);
}
function offsetToPosition(text, offset) {
    const safeOffset = clamp(offset, 0, text.length);
    const lines = getLines$1(text);
    const line = lineNumberAt(text, safeOffset);
    return { line, ch: safeOffset - lines[line].start };
}
/** Every heading in the note, in order, ignoring `#` lines inside code blocks. */
function listHeadings(text) {
    const doc = parseDocument(text);
    const headings = [];
    doc.headingLevels.forEach((level, line) => {
        if (level === null)
            return;
        headings.push({ line, level, text: doc.lines[line].text.replace(HEADING, "").replace(/\s+#+\s*$/u, "").trim() });
    });
    return headings;
}
function getDefaultSelectionRules() {
    return { ...DEFAULT_RULES };
}

const DEFAULT_INSERT_TOGGLE_HOTKEY = "Alt+A";
function getLines(text) {
    const lines = [];
    let start = 0;
    for (;;) {
        const end = text.indexOf("\n", start);
        lines.push({ start, end: end === -1 ? text.length : end, text: text.slice(start, end === -1 ? text.length : end) });
        if (end === -1)
            return lines;
        start = end + 1;
    }
}
function lineIndexAt(lines, offset) {
    let index = 0;
    while (index + 1 < lines.length && lines[index + 1].start <= offset)
        index += 1;
    return index;
}
/**
 * True when the selection covers whole lines: it starts at a line start and ends at a line end
 * (or at the start of the following line).
 */
function isWholeLineSelection(text, range) {
    if (range.from === range.to)
        return false;
    const lines = getLines(text);
    const first = lines[lineIndexAt(lines, range.from)];
    if (range.from !== first.start)
        return false;
    const last = lines[lineIndexAt(lines, range.to)];
    return range.to === last.end || range.to === last.start;
}
/** Headings the selection can be moved under: every heading not inside the selection itself. */
function movableTargets(text, range) {
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
function planMove(text, range, headingLine, position) {
    if (range.from === range.to)
        return null;
    const lines = getLines(text);
    const headings = listHeadings(text);
    const heading = headings.find((candidate) => candidate.line === headingLine);
    if (!heading)
        return null;
    // What is removed, and the text that moves.
    let removeFrom;
    let removeTo;
    let moved;
    let removedLines = null;
    if (isWholeLineSelection(text, range)) {
        const first = lineIndexAt(lines, range.from);
        let last = lineIndexAt(lines, range.to);
        if (range.to === lines[last].start && last > first)
            last -= 1;
        if (headingLine >= first && headingLine <= last)
            return null;
        removedLines = { first, last };
        moved = lines.slice(first, last + 1).map((line) => line.text).join("\n");
        if (last + 1 < lines.length) {
            removeFrom = lines[first].start;
            removeTo = lines[last + 1].start;
        }
        else {
            removeFrom = first > 0 ? lines[first - 1].end : 0;
            removeTo = lines[last].end;
        }
    }
    else {
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
            if (removedLines && line >= removedLines.first && line <= removedLines.last)
                continue;
            if (lines[line].text.trim() !== "")
                anchorLine = line;
        }
    }
    let insertAt = lines[anchorLine].end;
    // A partial selection can run through the anchor line's end; insert where the text is removed.
    if (insertAt > removeFrom && insertAt < removeTo)
        insertAt = removeFrom;
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

/** Quick-switcher-style list of the note's headings, with an Append/Prepend toggle. */
class HeadingSwitcherModal extends obsidian.SuggestModal {
    constructor(app, options) {
        super(app);
        this.options = options;
        this.toggle = null;
        this.positionLabels = new Map();
        this.onKeyDown = (event) => {
            const { toggleHotkey } = this.options;
            if (!toggleHotkey || !matchesHotkey(toggleHotkey, event, obsidian.Platform.isMacOS))
                return;
            event.preventDefault();
            event.stopPropagation();
            this.setPosition(this.position === "append" ? "prepend" : "append");
        };
        this.position = options.position;
        const { strings } = options;
        this.setPlaceholder(strings.placeholder);
        this.emptyStateText = strings.noMatch;
        this.limit = 1000;
        this.setInstructions([
            { command: "↑↓", purpose: strings.navigate },
            { command: "Tab", purpose: strings.autocomplete },
            { command: "↵", purpose: strings.move },
            { command: "esc", purpose: strings.dismiss }
        ]);
        this.scope.register([], "Tab", () => {
            this.autocomplete();
            return false;
        });
        this.modalEl.addClass("qes-heading-switcher");
    }
    onOpen() {
        void super.onOpen();
        this.renderToggle();
        this.modalEl.addEventListener("keydown", this.onKeyDown, true);
    }
    onClose() {
        this.modalEl.removeEventListener("keydown", this.onKeyDown, true);
        super.onClose();
    }
    /** Headings in note order; typing filters them (fuzzy, like the quick switcher) without re-sorting. */
    getSuggestions(query) {
        const trimmed = query.trim();
        if (!trimmed)
            return this.options.headings.map((heading) => ({ heading, match: null }));
        const search = obsidian.prepareFuzzySearch(trimmed);
        const suggestions = [];
        for (const heading of this.options.headings) {
            const match = search(heading.text);
            if (match)
                suggestions.push({ heading, match });
        }
        return suggestions;
    }
    renderSuggestion({ heading, match }, el) {
        el.addClass("qes-heading-suggestion");
        // Indented by level in styles.css, so each heading's #s line up with the text of the level above.
        el.createSpan({ cls: "qes-heading-level", text: "#".repeat(heading.level), attr: { "data-level": String(heading.level) } });
        // Long headings are cut off with "…" by CSS; hovering shows the full text.
        const textEl = el.createSpan({ cls: "qes-heading-text", attr: { title: heading.text } });
        obsidian.renderMatches(textEl, heading.text, match?.matches ?? null);
    }
    onChooseSuggestion({ heading }) {
        this.options.onChoose(heading, this.position);
    }
    /** "Prepend [toggle] Append (Alt+A)": Obsidian's settings toggle, off (left) = Prepend, on (right) = Append. */
    renderToggle() {
        const { strings, toggleHotkey } = this.options;
        const bar = createDiv({ cls: "qes-move-position" });
        this.inputEl.parentElement?.insertAdjacentElement("afterend", bar);
        const label = (position, text) => {
            const el = bar.createSpan({ cls: "qes-move-position-label", text });
            el.addEventListener("click", () => {
                this.setPosition(position);
                this.inputEl.focus();
            });
            this.positionLabels.set(position, el);
        };
        label("prepend", strings.prepend);
        this.toggle = new obsidian.ToggleComponent(bar)
            .setValue(this.position === "append")
            .onChange((on) => {
            this.setPosition(on ? "append" : "prepend");
            this.inputEl.focus();
        });
        this.toggle.toggleEl.setAttribute("aria-label", `${strings.prepend} / ${strings.append}`);
        label("append", strings.append);
        if (toggleHotkey) {
            bar.createSpan({ cls: "qes-move-position-hotkey", text: `(${formatHotkey(toggleHotkey, obsidian.Platform.isMacOS)})` });
        }
        this.updateToggle();
    }
    setPosition(position) {
        if (position === this.position)
            return;
        this.position = position;
        this.updateToggle();
        this.options.onPositionChange(position);
    }
    updateToggle() {
        if (this.toggle && this.toggle.getValue() !== (this.position === "append")) {
            this.toggle.setValue(this.position === "append");
        }
        for (const [position, label] of this.positionLabels)
            label.toggleClass("is-active", position === this.position);
    }
    /** Tab: fill the input with the highlighted heading, like the quick switcher. */
    autocomplete() {
        // `chooser` is SuggestModal's internal list; not public API, so read it defensively.
        const chooser = this.chooser;
        const values = chooser?.values ?? [];
        const selected = values[chooser?.selectedItem ?? 0] ?? values[0];
        if (!selected)
            return;
        this.inputEl.value = selected.heading.text;
        this.inputEl.dispatchEvent(new Event("input"));
    }
}
/** Asks before moving part of a line; resolves true to move, false to cancel. */
function confirmPartialMove(app, strings) {
    return new Promise((resolve) => {
        let answered = false;
        const modal = new obsidian.Modal(app);
        modal.setTitle(strings.partialTitle);
        modal.contentEl.createEl("p", { text: strings.partialMessage });
        const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
        const answer = (value) => {
            answered = true;
            resolve(value);
            modal.close();
        };
        const moveButton = buttons.createEl("button", { cls: "mod-cta", text: strings.partialConfirm });
        moveButton.addEventListener("click", () => answer(true));
        buttons.createEl("button", { text: strings.partialCancel }).addEventListener("click", () => answer(false));
        modal.onClose = () => {
            if (!answered)
                resolve(false);
        };
        modal.open();
        moveButton.focus();
    });
}

const en = {
    commands: {
        expandSelection: "Expand selection",
        shrinkSelection: "Shrink selection",
        moveToHeading: "Move selection to note heading"
    },
    move: {
        placeholder: "Move selection to note heading…",
        noMatch: "No matching heading.",
        navigate: "to navigate",
        autocomplete: "to autocomplete",
        move: "to move",
        dismiss: "to dismiss",
        append: "Append",
        prepend: "Prepend",
        nothingSelected: "Select the text to move first.",
        noHeadings: "This note has no headings to move the selection under.",
        noteChanged: "The note changed while choosing a heading, so nothing was moved.",
        partialTitle: "Move part of a line?",
        partialMessage: "The selection covers only part of a line. Only the selected text will move, onto its own line under the heading; the rest of the line stays where it is.",
        partialConfirm: "Move",
        partialCancel: "Cancel",
        settingsHeading: "Move selection to note heading",
        toggleHotkey: "Append/Prepend toggle hotkey",
        toggleHotkeyDescription: "Switches between Append and Prepend while the heading list is open, e.g. Alt+A or Mod+Shift+P (Mod is Ctrl, or Cmd on macOS). The list remembers your last choice.",
        toggleHotkeyInvalid: "Use modifiers plus one key, e.g. Alt+A.",
        cursorAfterMove: "Cursor after moving",
        cursorAfterMoveDescription: "Where the cursor goes once the text has moved.",
        cursorOptions: { stay: "Stay where it was", follow: "Follow the moved text" }
    },
    rules: {
        list: { name: "List hierarchy", description: "In a list, expand through the bullet line, the bullet with its children, each parent bullet with its children, then the whole list." },
        heading: { name: "Heading hierarchy", description: "Expand to the heading line, its section (up to the next heading of the same or higher level), then each parent section. Lists and paragraphs continue into these steps." },
        sentence: { name: "Sentences", description: "In a paragraph, expand to the current sentence before the whole paragraph." },
        code: { name: "Code blocks", description: "Use IDE-style expansion inside fenced code blocks, then the whole code block." },
        latex: { name: "LaTeX", description: "Recognize inline math, \\(...\\), \\[...\\], and $...$." },
        whitespace: { name: "Whitespace", description: "Add a step that extends the selection over neighbouring spaces and tabs." },
        punctuation: { name: "Punctuation and symbols", description: "Add a step that extends the selection over neighbouring punctuation and symbols." },
        pairs: { name: "Brackets and Markdown markers", description: "Add steps for enclosing brackets and **bold**, _italic_, `code` and ~~strikethrough~~ markers." },
        token: { name: "Token", description: "Add a step for the run of non-space characters around the selection." },
        line: { name: "Line within paragraph", description: "Add a step for the current line before the whole paragraph." }
    },
    settings: {
        heading: "Expansion rules",
        descriptionName: "About",
        description: "Expand and shrink selection commands appear in Obsidian's Hotkeys settings (defaults: Ctrl/Cmd+A and Ctrl/Cmd+Shift+A). Each press selects the next larger unit: list, paragraph and code steps lead into the heading steps, then the whole note.",
        sentenceMarkers: "Sentence end markers",
        sentenceMarkersDescription: "Characters that end a sentence. Half-width markers need a following space or line end; full-width markers such as 。 do not.",
        extraStepsHeading: "Extra steps",
        extraStepsDescription: "Optional finer steps between the word and the structural levels. Off by default.",
        aliases: ["Expansion rules", "Selection range"],
        resetHistory: "Reset expansion history",
        resetHistoryDescription: "Clear the expansion history for the current editor.",
        resetButton: "Reset"
    },
    coreCommands: {
        heading: "Core commands",
        wrap: "Wrap useful core commands",
        wrapDescription: "Add a command for each core command below that simply runs it, so they all appear together when you filter the command palette by this plugin's name. The core commands and their hotkeys are unchanged.",
        listName: "Wrapped core commands"
    },
    lists: {
        heading: "Lists",
        dragAndDrop: "Drag-and-drop",
        dragAndDropDescription: "Drag a bullet (or its checkbox or fold arrow) to move the item and its children. Press Escape to cancel. Desktop only.",
        verticalLines: "Draw vertical indentation lines",
        verticalLinesDescription: "Draw a line from each bullet down past its children.",
        verticalLinesAction: "Vertical indentation line click action",
        verticalLinesActionDescription: "What clicking a vertical line does.",
        verticalLinesActions: { none: "None", "toggle-folding": "Toggle folding" }
    },
    notices: {
        expansionHistoryReset: "Expansion history reset."
    }
};
const zhCn = {
    commands: {
        expandSelection: "扩选文本",
        shrinkSelection: "缩选文本",
        moveToHeading: "将所选内容移动到笔记标题下"
    },
    move: {
        placeholder: "将所选内容移动到笔记标题下…",
        noMatch: "没有匹配的标题。",
        navigate: "导航",
        autocomplete: "自动补全",
        move: "移动",
        dismiss: "关闭",
        append: "追加",
        prepend: "前置",
        nothingSelected: "请先选择要移动的文本。",
        noHeadings: "此笔记中没有可移动到的标题。",
        noteChanged: "选择标题期间笔记已更改，未移动任何内容。",
        partialTitle: "移动行的一部分？",
        partialMessage: "所选内容只覆盖了一行的一部分。只有所选文本会移动，并单独成行放在标题下；该行的其余部分保持不变。",
        partialConfirm: "移动",
        partialCancel: "取消",
        settingsHeading: "将所选内容移动到笔记标题下",
        toggleHotkey: "追加/前置切换快捷键",
        toggleHotkeyDescription: "在标题列表打开时切换追加和前置，例如 Alt+A 或 Mod+Shift+P（Mod 为 Ctrl，macOS 上为 Cmd）。列表会记住你上次的选择。",
        toggleHotkeyInvalid: "请使用修饰键加一个按键，例如 Alt+A。",
        cursorAfterMove: "移动后的光标位置",
        cursorAfterMoveDescription: "文本移动后光标所在的位置。",
        cursorOptions: { stay: "保持原位", follow: "跟随移动的文本" }
    },
    rules: {
        list: { name: "列表层级", description: "在列表中依次扩选当前行、当前项及其子项、各级父项及其子项，最后是整个列表。" },
        heading: { name: "标题层级", description: "依次扩选标题行、该标题的内容区域（直到下一个同级或更高级标题）、各级父标题区域。列表和段落会接续到这些层级。" },
        sentence: { name: "句子", description: "在段落中先扩选当前句子，再扩选整个段落。" },
        code: { name: "代码段", description: "在 fenced code block 内按 IDE 风格扩选，并支持整个代码段。" },
        latex: { name: "LaTeX", description: "识别行级数学环境、\\(...\\)、\\[...\\] 和 $...$。" },
        whitespace: { name: "空白字符", description: "增加一步：扩选到相邻的空格和制表符。" },
        punctuation: { name: "标点和符号", description: "增加一步：扩选到相邻的标点和符号。" },
        pairs: { name: "括号和 Markdown 标记", description: "增加括号以及 **粗体**、_斜体_、`代码`、~~删除线~~ 标记的扩选层级。" },
        token: { name: "连续字符", description: "增加一步：扩选到选区周围的连续非空白字符。" },
        line: { name: "段落内的行", description: "在扩选整个段落前先扩选当前行。" }
    },
    settings: {
        heading: "扩选规则",
        descriptionName: "说明",
        description: "扩选和缩选命令会出现在 Obsidian 的快捷键设置中（默认：Ctrl/Cmd+A 和 Ctrl/Cmd+Shift+A）。每次按键扩选到下一个更大的单元：列表、段落和代码会接续到标题层级，最后是整篇笔记。",
        sentenceMarkers: "句末标记",
        sentenceMarkersDescription: "表示句子结束的字符。半角标记后需要空格或行尾；全角标记（如 。）不需要。",
        extraStepsHeading: "额外层级",
        extraStepsDescription: "在单词和结构层级之间的可选细分层级，默认关闭。",
        aliases: ["扩选规则", "选择范围"],
        resetHistory: "重置扩选历史",
        resetHistoryDescription: "清除当前编辑器中的扩选层级记录。",
        resetButton: "重置"
    },
    coreCommands: {
        heading: "核心命令",
        wrap: "包装常用核心命令",
        wrapDescription: "为下列每个核心命令添加一个直接运行它的命令，这样在命令面板中按本插件名称筛选时它们会一起出现。核心命令及其快捷键保持不变。",
        listName: "已包装的核心命令"
    },
    lists: {
        heading: "列表",
        dragAndDrop: "拖放",
        dragAndDropDescription: "拖动项目符号（或复选框、折叠箭头）以移动该项及其子项。按 Esc 取消。仅限桌面端。",
        verticalLines: "绘制垂直缩进线",
        verticalLinesDescription: "从每个项目符号向下绘制一条贯穿其子项的线。",
        verticalLinesAction: "垂直缩进线点击操作",
        verticalLinesActionDescription: "点击垂直线时执行的操作。",
        verticalLinesActions: { none: "无", "toggle-folding": "切换折叠" }
    },
    notices: {
        expansionHistoryReset: "已重置扩选历史"
    }
};
function getLocaleStringsForLanguage(rawLanguage) {
    const language = rawLanguage.toLowerCase().replace(/_/g, "-");
    return language === "zh" ? zhCn : en;
}

function getLocaleStrings() {
    const language = typeof obsidian.getLanguage === "function" ? obsidian.getLanguage() : "en";
    return getLocaleStringsForLanguage(language);
}

/**
 * Core editor commands that sit naturally beside expand/shrink selection. V2 registers a thin
 * command for each that just runs the core command, so filtering the command palette by this
 * plugin's name lists them all together. The core commands themselves are left untouched.
 */
const WRAPPED_CORE_COMMANDS = [
    { id: "editor:swap-line-up", fallbackName: "Move line up" },
    { id: "editor:swap-line-down", fallbackName: "Move line down" },
    { id: "editor:indent-list", fallbackName: "Indent list" },
    { id: "editor:unindent-list", fallbackName: "Unindent list" },
    { id: "editor:toggle-fold", fallbackName: "Toggle fold on the current line" },
    { id: "editor:fold-more", fallbackName: "Fold more" },
    { id: "editor:fold-less", fallbackName: "Fold less" },
    { id: "editor:fold-all", fallbackName: "Fold all headings and lists" },
    { id: "editor:unfold-all", fallbackName: "Unfold all headings and lists" }
];
// `app.commands` is not part of Obsidian's public API, but is stable and widely used by plugins.
function registry(app) {
    return app.commands;
}
/** The core command's own (localised) name, without any "Editor: "-style prefix. */
function coreCommandName(app, id, fallbackName) {
    const name = registry(app).commands[id]?.name ?? fallbackName;
    return name.replace(/^[^:]+:\s*/u, "");
}
function wrapperId(coreId) {
    return `core-${coreId.replace(/^editor:/u, "")}`;
}
function registerCoreCommandWrappers(plugin) {
    for (const { id, fallbackName } of WRAPPED_CORE_COMMANDS) {
        plugin.addCommand({
            id: wrapperId(id),
            name: coreCommandName(plugin.app, id, fallbackName),
            editorCallback: () => {
                registry(plugin.app).executeCommandById(id);
            }
        });
    }
}
function removeCoreCommandWrappers(plugin) {
    for (const { id } of WRAPPED_CORE_COMMANDS)
        plugin.removeCommand(wrapperId(id));
}

const STRUCTURE_RULES = ["list", "heading", "sentence", "code", "latex"];
const EXTRA_STEP_RULES = ["whitespace", "punctuation", "pairs", "token", "line"];
const SENTENCE_MARKERS_KEY = "sentenceMarkers";
const LIST_KEYS = ["dragAndDrop", "verticalLines", "verticalLinesAction"];
class QuickExpandSelectionSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    getSettingDefinitions() {
        const strings = getLocaleStrings();
        const defaults = getDefaultSelectionRules();
        const toggle = (key) => ({
            name: strings.rules[key].name,
            desc: strings.rules[key].description,
            aliases: strings.settings.aliases,
            control: {
                type: "toggle",
                key: `rules.${key}`,
                defaultValue: defaults[key]
            }
        });
        const list = strings.lists;
        const core = strings.coreCommands;
        const move = strings.move;
        return [
            {
                type: "group",
                heading: move.settingsHeading,
                items: [
                    {
                        name: move.toggleHotkey,
                        desc: move.toggleHotkeyDescription,
                        control: {
                            type: "text",
                            key: "insertToggleHotkey",
                            defaultValue: DEFAULT_INSERT_TOGGLE_HOTKEY,
                            placeholder: DEFAULT_INSERT_TOGGLE_HOTKEY,
                            validate: (value) => (parseHotkey(value) ? undefined : move.toggleHotkeyInvalid)
                        }
                    },
                    {
                        name: move.cursorAfterMove,
                        desc: move.cursorAfterMoveDescription,
                        control: { type: "dropdown", key: "cursorAfterMove", defaultValue: "stay", options: move.cursorOptions }
                    }
                ]
            },
            {
                type: "group",
                heading: core.heading,
                items: [
                    {
                        name: core.wrap,
                        desc: core.wrapDescription,
                        control: { type: "toggle", key: "wrapCoreCommands", defaultValue: true }
                    },
                    {
                        name: core.listName,
                        desc: this.wrappedCommandList()
                    }
                ]
            },
            {
                type: "group",
                heading: list.heading,
                items: [
                    {
                        name: list.dragAndDrop,
                        desc: list.dragAndDropDescription,
                        control: { type: "toggle", key: "dragAndDrop", defaultValue: true }
                    },
                    {
                        name: list.verticalLines,
                        desc: list.verticalLinesDescription,
                        control: { type: "toggle", key: "verticalLines", defaultValue: true }
                    },
                    {
                        name: list.verticalLinesAction,
                        desc: list.verticalLinesActionDescription,
                        control: {
                            type: "dropdown",
                            key: "verticalLinesAction",
                            defaultValue: "toggle-folding",
                            options: list.verticalLinesActions
                        }
                    }
                ]
            },
            {
                type: "group",
                heading: strings.settings.heading,
                items: [
                    {
                        name: strings.settings.descriptionName,
                        desc: strings.settings.description
                    },
                    ...STRUCTURE_RULES.map(toggle),
                    {
                        name: strings.settings.sentenceMarkers,
                        desc: strings.settings.sentenceMarkersDescription,
                        control: {
                            type: "text",
                            key: SENTENCE_MARKERS_KEY,
                            defaultValue: DEFAULT_SENTENCE_MARKERS,
                            placeholder: DEFAULT_SENTENCE_MARKERS
                        }
                    }
                ]
            },
            {
                type: "group",
                heading: strings.settings.extraStepsHeading,
                items: [
                    {
                        name: strings.settings.descriptionName,
                        desc: strings.settings.extraStepsDescription
                    },
                    ...EXTRA_STEP_RULES.map(toggle),
                    {
                        name: strings.settings.resetHistory,
                        desc: strings.settings.resetHistoryDescription,
                        action: () => this.plugin.clearSelectionHistory()
                    }
                ]
            }
        ];
    }
    getControlValue(key) {
        if (key === "wrapCoreCommands")
            return this.plugin.settings.wrapCoreCommands;
        if (key === "insertToggleHotkey")
            return this.plugin.settings.insertToggleHotkey;
        if (key === "cursorAfterMove")
            return this.plugin.settings.cursorAfterMove;
        if (this.isListKey(key))
            return this.plugin.settings[key];
        if (key === SENTENCE_MARKERS_KEY)
            return this.plugin.settings.sentenceMarkers;
        const rule = this.getRuleKey(key);
        return rule ? this.plugin.settings.rules[rule] : undefined;
    }
    async setControlValue(key, value) {
        if (key === "insertToggleHotkey") {
            if (typeof value !== "string" || !parseHotkey(value))
                return;
            this.plugin.settings.insertToggleHotkey = value;
            await this.plugin.saveSettings();
            return;
        }
        if (key === "cursorAfterMove") {
            if (value !== "stay" && value !== "follow")
                return;
            this.plugin.settings.cursorAfterMove = value;
            await this.plugin.saveSettings();
            return;
        }
        if (key === "verticalLinesAction") {
            if (typeof value !== "string" || !(value in getLocaleStrings().lists.verticalLinesActions))
                return;
            this.plugin.settings.verticalLinesAction = value;
            await this.plugin.saveSettings();
            return;
        }
        if (key === "dragAndDrop" || key === "verticalLines" || key === "wrapCoreCommands") {
            if (typeof value !== "boolean")
                return;
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
            return;
        }
        if (key === SENTENCE_MARKERS_KEY) {
            if (typeof value !== "string")
                return;
            this.plugin.settings.sentenceMarkers = value;
            await this.plugin.saveSettings();
            return;
        }
        const rule = this.getRuleKey(key);
        if (!rule || typeof value !== "boolean")
            return;
        this.plugin.settings.rules[rule] = value;
        await this.plugin.saveSettings();
    }
    // Fallback for Obsidian versions before getSettingDefinitions (1.13).
    display() {
        const strings = getLocaleStrings();
        const { containerEl } = this;
        containerEl.empty();
        const list = strings.lists;
        const core = strings.coreCommands;
        const move = strings.move;
        new obsidian.Setting(containerEl).setName(move.settingsHeading).setHeading();
        new obsidian.Setting(containerEl)
            .setName(move.toggleHotkey)
            .setDesc(move.toggleHotkeyDescription)
            .addText((text) => {
            text
                .setPlaceholder(DEFAULT_INSERT_TOGGLE_HOTKEY)
                .setValue(this.plugin.settings.insertToggleHotkey)
                .onChange(async (value) => {
                if (!parseHotkey(value))
                    return;
                this.plugin.settings.insertToggleHotkey = value;
                await this.plugin.saveSettings();
            });
        });
        new obsidian.Setting(containerEl)
            .setName(move.cursorAfterMove)
            .setDesc(move.cursorAfterMoveDescription)
            .addDropdown((dropdown) => {
            dropdown
                .addOptions(move.cursorOptions)
                .setValue(this.plugin.settings.cursorAfterMove)
                .onChange(async (value) => {
                this.plugin.settings.cursorAfterMove = value;
                await this.plugin.saveSettings();
            });
        });
        new obsidian.Setting(containerEl).setName(core.heading).setHeading();
        new obsidian.Setting(containerEl)
            .setName(core.wrap)
            .setDesc(core.wrapDescription)
            .addToggle((toggle) => {
            toggle.setValue(this.plugin.settings.wrapCoreCommands).onChange(async (value) => {
                this.plugin.settings.wrapCoreCommands = value;
                await this.plugin.saveSettings();
            });
        });
        new obsidian.Setting(containerEl).setName(core.listName).setDesc(this.wrappedCommandList());
        new obsidian.Setting(containerEl).setName(list.heading).setHeading();
        for (const key of ["dragAndDrop", "verticalLines"]) {
            new obsidian.Setting(containerEl)
                .setName(list[key])
                .setDesc(list[`${key}Description`])
                .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
                    this.plugin.settings[key] = value;
                    await this.plugin.saveSettings();
                });
            });
        }
        new obsidian.Setting(containerEl)
            .setName(list.verticalLinesAction)
            .setDesc(list.verticalLinesActionDescription)
            .addDropdown((dropdown) => {
            dropdown
                .addOptions(list.verticalLinesActions)
                .setValue(this.plugin.settings.verticalLinesAction)
                .onChange(async (value) => {
                this.plugin.settings.verticalLinesAction = value;
                await this.plugin.saveSettings();
            });
        });
        const addToggle = (key) => {
            const description = strings.rules[key];
            new obsidian.Setting(containerEl)
                .setName(description.name)
                .setDesc(description.description)
                .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.rules[key])
                    .onChange(async (value) => {
                    this.plugin.settings.rules[key] = value;
                    await this.plugin.saveSettings();
                });
            });
        };
        new obsidian.Setting(containerEl).setName(strings.settings.heading).setHeading();
        containerEl.createEl("p", { text: strings.settings.description, cls: "setting-item-description" });
        STRUCTURE_RULES.forEach(addToggle);
        new obsidian.Setting(containerEl)
            .setName(strings.settings.sentenceMarkers)
            .setDesc(strings.settings.sentenceMarkersDescription)
            .addText((text) => {
            text
                .setPlaceholder(DEFAULT_SENTENCE_MARKERS)
                .setValue(this.plugin.settings.sentenceMarkers)
                .onChange(async (value) => {
                this.plugin.settings.sentenceMarkers = value;
                await this.plugin.saveSettings();
            });
        });
        new obsidian.Setting(containerEl).setName(strings.settings.extraStepsHeading).setHeading();
        containerEl.createEl("p", { text: strings.settings.extraStepsDescription, cls: "setting-item-description" });
        EXTRA_STEP_RULES.forEach(addToggle);
        new obsidian.Setting(containerEl)
            .setName(strings.settings.resetHistory)
            .setDesc(strings.settings.resetHistoryDescription)
            .addButton((button) => {
            button.setButtonText(strings.settings.resetButton).onClick(() => {
                this.plugin.clearSelectionHistory();
            });
        });
    }
    /** The wrapped commands, one per line, by their core names. */
    wrappedCommandList() {
        const fragment = document.createDocumentFragment();
        const items = fragment.createEl("ul");
        for (const { id, fallbackName } of WRAPPED_CORE_COMMANDS) {
            items.createEl("li", { text: coreCommandName(this.app, id, fallbackName) });
        }
        return fragment;
    }
    isListKey(key) {
        return LIST_KEYS.includes(key);
    }
    getRuleKey(key) {
        const prefix = "rules.";
        if (!key.startsWith(prefix))
            return null;
        const rule = key.slice(prefix.length);
        return Object.prototype.hasOwnProperty.call(getDefaultSelectionRules(), rule) ? rule : null;
    }
}

function cmpPos(a, b) {
    return a.line - b.line || a.ch - b.ch;
}
function isRangesIntersects(a, b) {
    return cmpPos(a[1], b[0]) >= 0 && cmpPos(a[0], b[1]) <= 0;
}
function recalculateNumericBullets(root) {
    function visit(parent) {
        let index = 1;
        for (const child of parent.getChildren()) {
            if (/\d+\./.test(child.getBullet())) {
                child.replateBullet(`${index++}.`);
            }
            visit(child);
        }
    }
    visit(root);
}
let idSeq = 0;
class List {
    constructor(root, indent, bullet, optionalCheckbox, spaceAfterBullet, firstLine, foldRoot) {
        this.root = root;
        this.indent = indent;
        this.bullet = bullet;
        this.optionalCheckbox = optionalCheckbox;
        this.spaceAfterBullet = spaceAfterBullet;
        this.foldRoot = foldRoot;
        this.parent = null;
        this.children = [];
        this.notesIndent = null;
        this.lines = [];
        this.id = idSeq++;
        this.lines.push(firstLine);
    }
    getID() {
        return this.id;
    }
    getNotesIndent() {
        return this.notesIndent;
    }
    setNotesIndent(notesIndent) {
        if (this.notesIndent !== null) {
            throw new Error(`Notes indent already provided`);
        }
        this.notesIndent = notesIndent;
    }
    addLine(text) {
        if (this.notesIndent === null) {
            throw new Error(`Unable to add line, notes indent should be provided first`);
        }
        this.lines.push(text);
    }
    replaceLines(lines) {
        if (lines.length > 1 && this.notesIndent === null) {
            throw new Error(`Unable to add line, notes indent should be provided first`);
        }
        this.lines = lines;
    }
    getLineCount() {
        return this.lines.length;
    }
    getRoot() {
        return this.root;
    }
    getChildren() {
        return this.children.concat();
    }
    getLinesInfo() {
        const startLine = this.root.getContentLinesRangeOf(this)[0];
        return this.lines.map((row, i) => {
            const line = startLine + i;
            const startCh = i === 0 ? this.getContentStartCh() : this.notesIndent.length;
            const endCh = startCh + row.length;
            return {
                text: row,
                from: { line, ch: startCh },
                to: { line, ch: endCh },
            };
        });
    }
    getLines() {
        return this.lines.concat();
    }
    getFirstLineContentStart() {
        const startLine = this.root.getContentLinesRangeOf(this)[0];
        return {
            line: startLine,
            ch: this.getContentStartCh(),
        };
    }
    getFirstLineContentStartAfterCheckbox() {
        const startLine = this.root.getContentLinesRangeOf(this)[0];
        return {
            line: startLine,
            ch: this.getContentStartCh() + this.getCheckboxLength(),
        };
    }
    getLastLineContentEnd() {
        const endLine = this.root.getContentLinesRangeOf(this)[1];
        const endCh = this.lines.length === 1
            ? this.getContentStartCh() + this.lines[0].length
            : this.notesIndent.length + this.lines[this.lines.length - 1].length;
        return {
            line: endLine,
            ch: endCh,
        };
    }
    getContentEndIncludingChildren() {
        return this.getLastChild().getLastLineContentEnd();
    }
    getLastChild() {
        let lastChild = this;
        while (!lastChild.isEmpty()) {
            lastChild = lastChild.getChildren().last();
        }
        return lastChild;
    }
    getContentStartCh() {
        return this.indent.length + this.bullet.length + 1;
    }
    isFolded() {
        if (this.foldRoot) {
            return true;
        }
        if (this.parent) {
            return this.parent.isFolded();
        }
        return false;
    }
    isFoldRoot() {
        return this.foldRoot;
    }
    getTopFoldRoot() {
        let tmp = this;
        let foldRoot = null;
        while (tmp) {
            if (tmp.isFoldRoot()) {
                foldRoot = tmp;
            }
            tmp = tmp.parent;
        }
        return foldRoot;
    }
    getLevel() {
        if (!this.parent) {
            return 0;
        }
        return this.parent.getLevel() + 1;
    }
    unindentContent(from, till) {
        this.indent = this.indent.slice(0, from) + this.indent.slice(till);
        if (this.notesIndent !== null) {
            this.notesIndent =
                this.notesIndent.slice(0, from) + this.notesIndent.slice(till);
        }
        for (const child of this.children) {
            child.unindentContent(from, till);
        }
    }
    indentContent(indentPos, indentChars) {
        this.indent =
            this.indent.slice(0, indentPos) +
                indentChars +
                this.indent.slice(indentPos);
        if (this.notesIndent !== null) {
            this.notesIndent =
                this.notesIndent.slice(0, indentPos) +
                    indentChars +
                    this.notesIndent.slice(indentPos);
        }
        for (const child of this.children) {
            child.indentContent(indentPos, indentChars);
        }
    }
    getFirstLineIndent() {
        return this.indent;
    }
    getBullet() {
        return this.bullet;
    }
    getSpaceAfterBullet() {
        return this.spaceAfterBullet;
    }
    getCheckboxLength() {
        return this.optionalCheckbox.length;
    }
    replateBullet(bullet) {
        this.bullet = bullet;
    }
    getParent() {
        return this.parent;
    }
    addBeforeAll(list) {
        this.children.unshift(list);
        list.parent = this;
    }
    addAfterAll(list) {
        this.children.push(list);
        list.parent = this;
    }
    removeChild(list) {
        const i = this.children.indexOf(list);
        this.children.splice(i, 1);
        list.parent = null;
    }
    addBefore(before, list) {
        const i = this.children.indexOf(before);
        this.children.splice(i, 0, list);
        list.parent = this;
    }
    addAfter(before, list) {
        const i = this.children.indexOf(before);
        this.children.splice(i + 1, 0, list);
        list.parent = this;
    }
    getPrevSiblingOf(list) {
        const i = this.children.indexOf(list);
        return i > 0 ? this.children[i - 1] : null;
    }
    getNextSiblingOf(list) {
        const i = this.children.indexOf(list);
        return i >= 0 && i < this.children.length ? this.children[i + 1] : null;
    }
    isEmpty() {
        return this.children.length === 0;
    }
    print() {
        let res = "";
        for (let i = 0; i < this.lines.length; i++) {
            res +=
                i === 0
                    ? this.indent + this.bullet + this.spaceAfterBullet
                    : this.notesIndent;
            res += this.lines[i];
            res += "\n";
        }
        for (const child of this.children) {
            res += child.print();
        }
        return res;
    }
    clone(newRoot) {
        const clone = new List(newRoot, this.indent, this.bullet, this.optionalCheckbox, this.spaceAfterBullet, "", this.foldRoot);
        clone.id = this.id;
        clone.lines = this.lines.concat();
        clone.notesIndent = this.notesIndent;
        for (const child of this.children) {
            clone.addAfterAll(child.clone(newRoot));
        }
        return clone;
    }
}
class Root {
    constructor(start, end, selections) {
        this.start = start;
        this.end = end;
        this.rootList = new List(this, "", "", "", "", "", false);
        this.selections = [];
        this.replaceSelections(selections);
    }
    getRootList() {
        return this.rootList;
    }
    getContentRange() {
        return [this.getContentStart(), this.getContentEnd()];
    }
    getContentStart() {
        return { ...this.start };
    }
    getContentEnd() {
        return { ...this.end };
    }
    getSelections() {
        return this.selections.map((s) => ({
            anchor: { ...s.anchor },
            head: { ...s.head },
        }));
    }
    hasSingleCursor() {
        if (!this.hasSingleSelection()) {
            return false;
        }
        const selection = this.selections[0];
        return (selection.anchor.line === selection.head.line &&
            selection.anchor.ch === selection.head.ch);
    }
    hasSingleSelection() {
        return this.selections.length === 1;
    }
    getSelection() {
        const selection = this.selections[this.selections.length - 1];
        const from = selection.anchor.ch > selection.head.ch
            ? selection.head.ch
            : selection.anchor.ch;
        const to = selection.anchor.ch > selection.head.ch
            ? selection.anchor.ch
            : selection.head.ch;
        return {
            ...selection,
            from,
            to,
        };
    }
    getCursor() {
        return { ...this.selections[this.selections.length - 1].head };
    }
    replaceCursor(cursor) {
        this.selections = [{ anchor: cursor, head: cursor }];
    }
    replaceSelections(selections) {
        if (selections.length < 1) {
            throw new Error(`Unable to create Root without selections`);
        }
        this.selections = selections;
    }
    getListUnderCursor() {
        return this.getListUnderLine(this.getCursor().line);
    }
    getListUnderLine(line) {
        if (line < this.start.line || line > this.end.line) {
            return;
        }
        let result = null;
        let index = this.start.line;
        const visitArr = (ll) => {
            for (const l of ll) {
                const listFromLine = index;
                const listTillLine = listFromLine + l.getLineCount() - 1;
                if (line >= listFromLine && line <= listTillLine) {
                    result = l;
                }
                else {
                    index = listTillLine + 1;
                    visitArr(l.getChildren());
                }
                if (result !== null) {
                    return;
                }
            }
        };
        visitArr(this.rootList.getChildren());
        return result;
    }
    getContentLinesRangeOf(list) {
        let result = null;
        let line = this.start.line;
        const visitArr = (ll) => {
            for (const l of ll) {
                const listFromLine = line;
                const listTillLine = listFromLine + l.getLineCount() - 1;
                if (l === list) {
                    result = [listFromLine, listTillLine];
                }
                else {
                    line = listTillLine + 1;
                    visitArr(l.getChildren());
                }
                if (result !== null) {
                    return;
                }
            }
        };
        visitArr(this.rootList.getChildren());
        return result;
    }
    getChildren() {
        return this.rootList.getChildren();
    }
    print() {
        let res = "";
        for (const child of this.rootList.getChildren()) {
            res += child.print();
        }
        return res.replace(/\n$/, "");
    }
    clone() {
        const clone = new Root({ ...this.start }, { ...this.end }, this.getSelections());
        clone.rootList = this.rootList.clone(clone);
        return clone;
    }
}

class ChangesApplicator {
    apply(editor, prevRoot, newRoot) {
        const changes = this.calculateChanges(editor, prevRoot, newRoot);
        if (changes) {
            const { replacement, changeFrom, changeTo } = changes;
            const { unfold, fold } = this.calculateFoldingOprations(prevRoot, newRoot, changeFrom, changeTo);
            for (const line of unfold) {
                editor.unfold(line);
            }
            editor.replaceRange(replacement, changeFrom, changeTo);
            for (const line of fold) {
                editor.fold(line);
            }
        }
        editor.setSelections(newRoot.getSelections());
    }
    calculateChanges(editor, prevRoot, newRoot) {
        const rootRange = prevRoot.getContentRange();
        const oldString = editor.getRange(rootRange[0], rootRange[1]);
        const newString = newRoot.print();
        const changeFrom = { ...rootRange[0] };
        const changeTo = { ...rootRange[1] };
        let oldTmp = oldString;
        let newTmp = newString;
        while (true) {
            const nlIndex = oldTmp.lastIndexOf("\n");
            if (nlIndex < 0) {
                break;
            }
            const oldLine = oldTmp.slice(nlIndex);
            const newLine = newTmp.slice(-oldLine.length);
            if (oldLine !== newLine) {
                break;
            }
            oldTmp = oldTmp.slice(0, -oldLine.length);
            newTmp = newTmp.slice(0, -oldLine.length);
            const nlIndex2 = oldTmp.lastIndexOf("\n");
            changeTo.ch =
                nlIndex2 >= 0 ? oldTmp.length - nlIndex2 - 1 : oldTmp.length;
            changeTo.line--;
        }
        while (true) {
            const nlIndex = oldTmp.indexOf("\n");
            if (nlIndex < 0) {
                break;
            }
            const oldLine = oldTmp.slice(0, nlIndex + 1);
            const newLine = newTmp.slice(0, oldLine.length);
            if (oldLine !== newLine) {
                break;
            }
            changeFrom.line++;
            oldTmp = oldTmp.slice(oldLine.length);
            newTmp = newTmp.slice(oldLine.length);
        }
        if (oldTmp === newTmp) {
            return null;
        }
        return {
            replacement: newTmp,
            changeFrom,
            changeTo,
        };
    }
    calculateFoldingOprations(prevRoot, newRoot, changeFrom, changeTo) {
        const changedRange = [changeFrom, changeTo];
        const prevLists = getAllChildren(prevRoot);
        const newLists = getAllChildren(newRoot);
        const unfold = [];
        const fold = [];
        for (const prevList of prevLists.values()) {
            if (!prevList.isFoldRoot()) {
                continue;
            }
            const newList = newLists.get(prevList.getID());
            if (!newList) {
                continue;
            }
            const prevListRange = [
                prevList.getFirstLineContentStart(),
                prevList.getContentEndIncludingChildren(),
            ];
            if (isRangesIntersects(prevListRange, changedRange)) {
                unfold.push(prevList.getFirstLineContentStart().line);
                fold.push(newList.getFirstLineContentStart().line);
            }
        }
        unfold.sort((a, b) => b - a);
        fold.sort((a, b) => b - a);
        return { unfold, fold };
    }
}
function getAllChildrenReduceFn(acc, child) {
    acc.set(child.getID(), child);
    child.getChildren().reduce(getAllChildrenReduceFn, acc);
    return acc;
}
function getAllChildren(root) {
    return root.getChildren().reduce(getAllChildrenReduceFn, new Map());
}

function getEditorFromState(state) {
    const { editor } = state.field(obsidian.editorInfoField);
    if (!editor) {
        return null;
    }
    return new MyEditor(editor);
}
function foldInside(view, from, to) {
    let found = null;
    language.foldedRanges(view.state).between(from, to, (from, to) => {
        if (!found || found.from > from)
            found = { from, to };
    });
    return found;
}
class MyEditor {
    constructor(e) {
        this.e = e;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.view = this.e.cm;
    }
    getCursor() {
        return this.e.getCursor();
    }
    getLine(n) {
        return this.e.getLine(n);
    }
    lastLine() {
        return this.e.lastLine();
    }
    listSelections() {
        return this.e.listSelections();
    }
    getRange(from, to) {
        return this.e.getRange(from, to);
    }
    replaceRange(replacement, from, to) {
        return this.e.replaceRange(replacement, from, to);
    }
    setSelections(selections) {
        this.e.setSelections(selections);
    }
    setValue(text) {
        this.e.setValue(text);
    }
    getValue() {
        return this.e.getValue();
    }
    offsetToPos(offset) {
        return this.e.offsetToPos(offset);
    }
    posToOffset(pos) {
        return this.e.posToOffset(pos);
    }
    fold(n) {
        const { view } = this;
        const l = view.lineBlockAt(view.state.doc.line(n + 1).from);
        const range = language.foldable(view.state, l.from, l.to);
        if (!range || range.from === range.to) {
            return;
        }
        view.dispatch({ effects: [language.foldEffect.of(range)] });
    }
    unfold(n) {
        const { view } = this;
        const l = view.lineBlockAt(view.state.doc.line(n + 1).from);
        const range = foldInside(view, l.from, l.to);
        if (!range) {
            return;
        }
        view.dispatch({ effects: [language.unfoldEffect.of(range)] });
    }
    getAllFoldedLines() {
        const c = language.foldedRanges(this.view.state).iter();
        const res = [];
        while (c.value) {
            res.push(this.offsetToPos(c.from).line);
            c.next();
        }
        return res;
    }
    triggerOnKeyDown(e) {
        view.runScopeHandlers(this.view, e, "editor");
    }
}

class MoveListToDifferentPosition {
    constructor(root, listToMove, placeToMove, whereToMove, defaultIndentChars) {
        this.root = root;
        this.listToMove = listToMove;
        this.placeToMove = placeToMove;
        this.whereToMove = whereToMove;
        this.defaultIndentChars = defaultIndentChars;
        this.stopPropagation = false;
        this.updated = false;
    }
    shouldStopPropagation() {
        return this.stopPropagation;
    }
    shouldUpdate() {
        return this.updated;
    }
    perform() {
        if (this.listToMove === this.placeToMove) {
            return;
        }
        this.stopPropagation = true;
        this.updated = true;
        const cursorAnchor = this.calculateCursorAnchor();
        this.moveList();
        this.changeIndent();
        this.restoreCursor(cursorAnchor);
        recalculateNumericBullets(this.root);
    }
    calculateCursorAnchor() {
        const cursorLine = this.root.getCursor().line;
        const lines = [
            this.listToMove.getFirstLineContentStart().line,
            this.listToMove.getLastLineContentEnd().line,
            this.placeToMove.getFirstLineContentStart().line,
            this.placeToMove.getLastLineContentEnd().line,
        ];
        const listStartLine = Math.min(...lines);
        const listEndLine = Math.max(...lines);
        if (cursorLine < listStartLine || cursorLine > listEndLine) {
            return null;
        }
        const cursor = this.root.getCursor();
        const cursorList = this.root.getListUnderLine(cursor.line);
        const cursorListStart = cursorList.getFirstLineContentStart();
        const lineDiff = cursor.line - cursorListStart.line;
        const chDiff = cursor.ch - cursorListStart.ch;
        return { cursorList, lineDiff, chDiff };
    }
    moveList() {
        this.listToMove.getParent().removeChild(this.listToMove);
        switch (this.whereToMove) {
            case "before":
                this.placeToMove
                    .getParent()
                    .addBefore(this.placeToMove, this.listToMove);
                break;
            case "after":
                this.placeToMove
                    .getParent()
                    .addAfter(this.placeToMove, this.listToMove);
                break;
            case "inside":
                this.placeToMove.addBeforeAll(this.listToMove);
                break;
        }
    }
    changeIndent() {
        const oldIndent = this.listToMove.getFirstLineIndent();
        const newIndent = this.whereToMove === "inside"
            ? this.placeToMove.getFirstLineIndent() + this.defaultIndentChars
            : this.placeToMove.getFirstLineIndent();
        this.listToMove.unindentContent(0, oldIndent.length);
        this.listToMove.indentContent(0, newIndent);
    }
    restoreCursor(cursorAnchor) {
        if (cursorAnchor) {
            const cursorListStart = cursorAnchor.cursorList.getFirstLineContentStart();
            this.root.replaceCursor({
                line: cursorListStart.line + cursorAnchor.lineDiff,
                ch: cursorListStart.ch + cursorAnchor.chDiff,
            });
        }
        else {
            // When you move a list, the screen scrolls to the cursor.
            // It is better to move the cursor into the viewport than let the screen scroll.
            this.root.replaceCursor(this.listToMove.getLastLineContentEnd());
        }
    }
}

const BODY_CLASS = "qes-outliner-dnd";
class DragAndDrop {
    constructor(plugin, settings, obisidian, parser, operationPerformer) {
        this.plugin = plugin;
        this.settings = settings;
        this.obisidian = obisidian;
        this.parser = parser;
        this.operationPerformer = operationPerformer;
        this.preStart = null;
        this.state = null;
        this.handleSettingsChange = () => {
            if (!isFeatureSupported()) {
                return;
            }
            if (this.settings.dragAndDrop) {
                document.body.classList.add(BODY_CLASS);
            }
            else {
                document.body.classList.remove(BODY_CLASS);
            }
        };
        this.handleMouseDown = (e) => {
            if (!isFeatureSupported() ||
                !this.settings.dragAndDrop ||
                !isClickOnBullet(e)) {
                return;
            }
            const view = getEditorViewFromHTMLElement(e.target);
            if (!view) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.preStart = {
                x: e.x,
                y: e.y,
                view,
            };
        };
        this.handleMouseMove = (e) => {
            if (this.preStart) {
                this.startDragging();
            }
            if (this.state) {
                this.detectAndDrawDropZone(e.x, e.y);
            }
        };
        this.handleMouseUp = () => {
            if (this.preStart) {
                this.preStart = null;
            }
            if (this.state) {
                this.stopDragging();
            }
        };
        this.handleKeyDown = (e) => {
            if (this.state && e.code === "Escape") {
                this.cancelDragging();
            }
        };
    }
    async load() {
        this.plugin.registerEditorExtension([
            draggingLinesStateField,
            droppingLinesStateField,
        ]);
        this.enableFeatureToggle();
        this.createDropZone();
        this.addEventListeners();
    }
    async unload() {
        this.removeEventListeners();
        this.removeDropZone();
        this.disableFeatureToggle();
    }
    enableFeatureToggle() {
        this.settings.onChange(this.handleSettingsChange);
        this.handleSettingsChange();
    }
    disableFeatureToggle() {
        this.settings.removeCallback(this.handleSettingsChange);
        document.body.classList.remove(BODY_CLASS);
    }
    createDropZone() {
        this.dropZonePadding = document.createElement("div");
        this.dropZonePadding.classList.add("qes-outliner-drop-zone-padding");
        this.dropZone = document.createElement("div");
        this.dropZone.classList.add("qes-outliner-drop-zone");
        this.dropZone.style.display = "none";
        this.dropZone.appendChild(this.dropZonePadding);
        document.body.appendChild(this.dropZone);
    }
    removeDropZone() {
        document.body.removeChild(this.dropZone);
        this.dropZonePadding = null;
        this.dropZone = null;
    }
    addEventListeners() {
        document.addEventListener("mousedown", this.handleMouseDown, {
            capture: true,
        });
        document.addEventListener("mousemove", this.handleMouseMove);
        document.addEventListener("mouseup", this.handleMouseUp);
        document.addEventListener("keydown", this.handleKeyDown);
    }
    removeEventListeners() {
        document.removeEventListener("mousedown", this.handleMouseDown, {
            capture: true,
        });
        document.removeEventListener("mousemove", this.handleMouseMove);
        document.removeEventListener("mouseup", this.handleMouseUp);
        document.removeEventListener("keydown", this.handleKeyDown);
    }
    startDragging() {
        const { x, y, view } = this.preStart;
        this.preStart = null;
        const editor = getEditorFromState(view.state);
        const pos = editor.offsetToPos(view.posAtCoords({ x, y }));
        const root = this.parser.parse(editor, pos);
        const list = root.getListUnderLine(pos.line);
        const state = new DragAndDropState(view, editor, root, list);
        if (!state.hasDropVariants()) {
            return;
        }
        this.state = state;
        this.highlightDraggingLines();
    }
    detectAndDrawDropZone(x, y) {
        this.state.calculateNearestDropVariant(x, y);
        this.drawDropZone();
    }
    cancelDragging() {
        this.state.dropVariant = null;
        this.stopDragging();
    }
    stopDragging() {
        this.unhightlightDraggingLines();
        this.hideDropZone();
        this.applyChanges();
        this.state = null;
    }
    applyChanges() {
        if (!this.state.dropVariant) {
            return;
        }
        const { state } = this;
        const { dropVariant, editor, root, list } = state;
        const newRoot = this.parser.parse(editor, root.getContentStart());
        if (!isSameRoots(root, newRoot)) {
            new obsidian.Notice(`The item cannot be moved. The page content changed during the move.`, 5000);
            return;
        }
        this.operationPerformer.eval(root, new MoveListToDifferentPosition(root, list, dropVariant.placeToMove, dropVariant.whereToMove, this.obisidian.getDefaultIndentChars()), editor);
    }
    highlightDraggingLines() {
        const { state } = this;
        const { list, editor, view } = state;
        const lines = [];
        const fromLine = list.getFirstLineContentStart().line;
        const tillLine = list.getContentEndIncludingChildren().line;
        for (let i = fromLine; i <= tillLine; i++) {
            lines.push(editor.posToOffset({ line: i, ch: 0 }));
        }
        view.dispatch({
            effects: [dndStarted.of(lines)],
        });
        document.body.classList.add("qes-outliner-dragging");
    }
    unhightlightDraggingLines() {
        document.body.classList.remove("qes-outliner-dragging");
        this.state.view.dispatch({
            effects: [dndEnded.of()],
        });
    }
    drawDropZone() {
        const { state } = this;
        const { view, editor, dropVariant } = state;
        const newParent = dropVariant.whereToMove === "inside"
            ? dropVariant.placeToMove
            : dropVariant.placeToMove.getParent();
        const newParentIsRootList = !newParent.getParent();
        {
            const width = Math.round(view.contentDOM.offsetWidth -
                (dropVariant.left - this.state.leftPadding));
            this.dropZone.style.display = "block";
            this.dropZone.style.top = dropVariant.top + "px";
            this.dropZone.style.left = dropVariant.left + "px";
            this.dropZone.style.width = width + "px";
        }
        {
            const level = newParent.getLevel();
            const indentWidth = this.state.tabWidth;
            const width = indentWidth * level;
            const dashPadding = 3;
            const dashWidth = indentWidth - dashPadding;
            const color = getComputedStyle(document.body).getPropertyValue("--color-accent");
            this.dropZonePadding.style.width = `${width}px`;
            this.dropZonePadding.style.marginLeft = `-${width}px`;
            this.dropZonePadding.style.backgroundImage = `url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%20${width}%204%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cline%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%22${width}%22%20y2%3D%220%22%20stroke%3D%22${color}%22%20stroke-width%3D%228%22%20stroke-dasharray%3D%22${dashWidth}%20${dashPadding}%22%2F%3E%3C%2Fsvg%3E')`;
        }
        this.state.view.dispatch({
            effects: [
                dndMoved.of(newParentIsRootList
                    ? null
                    : editor.posToOffset({
                        line: newParent.getFirstLineContentStart().line,
                        ch: 0,
                    })),
            ],
        });
    }
    hideDropZone() {
        this.dropZone.style.display = "none";
    }
}
class DragAndDropState {
    constructor(view, editor, root, list) {
        this.view = view;
        this.editor = editor;
        this.root = root;
        this.list = list;
        this.dropVariants = new Map();
        this.dropVariant = null;
        this.leftPadding = 0;
        this.tabWidth = 0;
        this.collectDropVariants();
        this.calculateLeftPadding();
        this.calculateTabWidth();
    }
    getDropVariants() {
        return Array.from(this.dropVariants.values());
    }
    hasDropVariants() {
        return this.dropVariants.size > 0;
    }
    calculateNearestDropVariant(x, y) {
        const { view, editor } = this;
        const dropVariants = this.getDropVariants();
        const possibleDropVariants = [];
        for (const v of dropVariants) {
            const { placeToMove } = v;
            const positionAfterList = v.whereToMove === "after" || v.whereToMove === "inside";
            const line = positionAfterList
                ? placeToMove.getContentEndIncludingChildren().line
                : placeToMove.getFirstLineContentStart().line;
            const linePos = editor.posToOffset({
                line,
                ch: 0,
            });
            const coords = view.coordsAtPos(linePos, -1);
            if (!coords) {
                continue;
            }
            v.left = this.leftPadding + (v.level - 1) * this.tabWidth;
            v.top = coords.top;
            if (positionAfterList) {
                v.top += view.lineBlockAt(linePos).height;
            }
            // Better vertical alignment
            v.top -= 8;
            possibleDropVariants.push(v);
        }
        const nearestLineTop = possibleDropVariants
            .sort((a, b) => Math.abs(y - a.top) - Math.abs(y - b.top))
            .first().top;
        const variansOnNearestLine = possibleDropVariants.filter((v) => Math.abs(v.top - nearestLineTop) <= 4);
        this.dropVariant = variansOnNearestLine
            .sort((a, b) => Math.abs(x - a.left) - Math.abs(x - b.left))
            .first();
    }
    addDropVariant(v) {
        this.dropVariants.set(`${v.line} ${v.level}`, v);
    }
    collectDropVariants() {
        const visit = (lists) => {
            for (const placeToMove of lists) {
                const lineBefore = placeToMove.getFirstLineContentStart().line;
                const lineAfter = placeToMove.getContentEndIncludingChildren().line + 1;
                const level = placeToMove.getLevel();
                this.addDropVariant({
                    line: lineBefore,
                    level,
                    left: 0,
                    top: 0,
                    placeToMove,
                    whereToMove: "before",
                });
                this.addDropVariant({
                    line: lineAfter,
                    level,
                    left: 0,
                    top: 0,
                    placeToMove,
                    whereToMove: "after",
                });
                if (placeToMove === this.list) {
                    continue;
                }
                if (placeToMove.isEmpty()) {
                    this.addDropVariant({
                        line: lineAfter,
                        level: level + 1,
                        left: 0,
                        top: 0,
                        placeToMove,
                        whereToMove: "inside",
                    });
                }
                else {
                    visit(placeToMove.getChildren());
                }
            }
        };
        visit(this.root.getChildren());
    }
    calculateLeftPadding() {
        const cmLine = this.view.dom.querySelector("div.cm-line");
        this.leftPadding = cmLine.getBoundingClientRect().left;
    }
    calculateTabWidth() {
        const { view } = this;
        const indentDom = view.dom.querySelector(".cm-indent");
        if (indentDom) {
            this.tabWidth = indentDom.offsetWidth;
            return;
        }
        const singleIndent = language.indentString(view.state, language.getIndentUnit(view.state));
        for (let i = 1; i <= view.state.doc.lines; i++) {
            const line = view.state.doc.line(i);
            if (line.text.startsWith(singleIndent)) {
                const a = view.coordsAtPos(line.from, -1);
                if (!a) {
                    continue;
                }
                const b = view.coordsAtPos(line.from + singleIndent.length, -1);
                if (!b) {
                    continue;
                }
                this.tabWidth = b.left - a.left;
                return;
            }
        }
        this.tabWidth = view.defaultCharacterWidth * language.getIndentUnit(view.state);
    }
}
const dndStarted = state.StateEffect.define({
    map: (lines, change) => lines.map((l) => change.mapPos(l)),
});
const dndMoved = state.StateEffect.define({
    map: (line, change) => (line !== null ? change.mapPos(line) : line),
});
const dndEnded = state.StateEffect.define();
const draggingLineDecoration = view.Decoration.line({
    class: "qes-outliner-dragging-line",
});
const droppingLineDecoration = view.Decoration.line({
    class: "qes-outliner-dropping-line",
});
const draggingLinesStateField = state.StateField.define({
    create: () => view.Decoration.none,
    update: (dndState, tr) => {
        dndState = dndState.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(dndStarted)) {
                dndState = dndState.update({
                    add: e.value.map((l) => draggingLineDecoration.range(l, l)),
                });
            }
            if (e.is(dndEnded)) {
                dndState = view.Decoration.none;
            }
        }
        return dndState;
    },
    provide: (f) => view.EditorView.decorations.from(f),
});
const droppingLinesStateField = state.StateField.define({
    create: () => view.Decoration.none,
    update: (dndDroppingState, tr) => {
        dndDroppingState = dndDroppingState.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(dndMoved)) {
                dndDroppingState =
                    e.value === null
                        ? view.Decoration.none
                        : view.Decoration.set(droppingLineDecoration.range(e.value, e.value));
            }
            if (e.is(dndEnded)) {
                dndDroppingState = view.Decoration.none;
            }
        }
        return dndDroppingState;
    },
    provide: (f) => view.EditorView.decorations.from(f),
});
function getEditorViewFromHTMLElement(e) {
    while (e && !e.classList.contains("cm-editor")) {
        e = e.parentElement;
    }
    if (!e) {
        return null;
    }
    return view.EditorView.findFromDOM(e);
}
function isClickOnBullet(e) {
    let el = e.target;
    while (el) {
        if (el.classList.contains("cm-formatting-list") ||
            el.classList.contains("cm-fold-indicator") ||
            el.classList.contains("task-list-item-checkbox")) {
            return true;
        }
        el = el.parentElement;
    }
    return false;
}
function isSameRoots(a, b) {
    const [aStart, aEnd] = a.getContentRange();
    const [bStart, bEnd] = b.getContentRange();
    if (cmpPos(aStart, bStart) !== 0 || cmpPos(aEnd, bEnd) !== 0) {
        return false;
    }
    return a.print() === b.print();
}
function isFeatureSupported() {
    return obsidian.Platform.isDesktop;
}

function getHiddenObsidianConfig(app) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return app.vault.config;
}
class ObsidianSettings {
    constructor(app) {
        this.app = app;
    }
    isLegacyEditorEnabled() {
        const config = {
            legacyEditor: false,
            ...getHiddenObsidianConfig(this.app),
        };
        return config.legacyEditor;
    }
    isDefaultThemeEnabled() {
        const config = {
            cssTheme: "",
            ...getHiddenObsidianConfig(this.app),
        };
        return config.cssTheme === "";
    }
    getTabsSettings() {
        return {
            useTab: true,
            tabSize: 4,
            ...getHiddenObsidianConfig(this.app),
        };
    }
    getFoldSettings() {
        return {
            foldIndent: true,
            ...getHiddenObsidianConfig(this.app),
        };
    }
    getDefaultIndentChars() {
        const { useTab, tabSize } = this.getTabsSettings();
        return useTab ? "\t" : new Array(tabSize).fill(" ").join("");
    }
}

class OperationPerformer {
    constructor(parser, changesApplicator) {
        this.parser = parser;
        this.changesApplicator = changesApplicator;
    }
    eval(root, op, editor) {
        const prevRoot = root.clone();
        op.perform();
        if (op.shouldUpdate()) {
            this.changesApplicator.apply(editor, prevRoot, root);
        }
        return {
            shouldUpdate: op.shouldUpdate(),
            shouldStopPropagation: op.shouldStopPropagation(),
        };
    }
    perform(cb, editor, cursor = editor.getCursor()) {
        const root = this.parser.parse(editor, cursor);
        if (!root) {
            return { shouldUpdate: false, shouldStopPropagation: false };
        }
        const op = cb(root);
        return this.eval(root, op, editor);
    }
}

const checkboxRe = `\\[[^\\[\\]]\\][ \t]`;

const bulletSignRe = `(?:[-*+]|\\d+\\.)`;
const optionalCheckboxRe = `(?:${checkboxRe})?`;
const listItemWithoutSpacesRe = new RegExp(`^${bulletSignRe}( |\t)`);
const listItemRe = new RegExp(`^[ \t]*${bulletSignRe}( |\t)`);
const stringWithSpacesRe = new RegExp(`^[ \t]+`);
const parseListItemRe = new RegExp(`^([ \t]*)(${bulletSignRe})( |\t)(${optionalCheckboxRe})(.*)$`);
class Parser {
    constructor() {
        // Outliner's default: the cursor may sit before the checkbox, so it counts as content.
        this.keepCursorWithinContent = "bullet-and-checkbox";
    }
    parseRange(editor, fromLine = 0, toLine = editor.lastLine()) {
        const lists = [];
        for (let i = fromLine; i <= toLine; i++) {
            const line = editor.getLine(i);
            if (i === fromLine || this.isListItem(line)) {
                const list = this.parseWithLimits(editor, i, fromLine, toLine);
                if (list) {
                    lists.push(list);
                    i = list.getContentEnd().line;
                }
            }
        }
        return lists;
    }
    parse(editor, cursor = editor.getCursor()) {
        return this.parseWithLimits(editor, cursor.line, 0, editor.lastLine());
    }
    parseWithLimits(editor, parsingStartLine, limitFrom, limitTo) {
        const d = (..._args) => { };
        const error = (msg) => {
            d(msg);
            return null;
        };
        const line = editor.getLine(parsingStartLine);
        let listLookingPos = null;
        if (this.isListItem(line)) {
            listLookingPos = parsingStartLine;
        }
        else if (this.isLineWithIndent(line)) {
            let listLookingPosSearch = parsingStartLine - 1;
            while (listLookingPosSearch >= 0) {
                const line = editor.getLine(listLookingPosSearch);
                if (this.isListItem(line)) {
                    listLookingPos = listLookingPosSearch;
                    break;
                }
                else if (this.isLineWithIndent(line)) {
                    listLookingPosSearch--;
                }
                else {
                    break;
                }
            }
        }
        if (listLookingPos === null) {
            return null;
        }
        let listStartLine = null;
        let listStartLineLookup = listLookingPos;
        while (listStartLineLookup >= 0) {
            const line = editor.getLine(listStartLineLookup);
            if (!this.isListItem(line) && !this.isLineWithIndent(line)) {
                break;
            }
            if (this.isListItemWithoutSpaces(line)) {
                listStartLine = listStartLineLookup;
                if (listStartLineLookup <= limitFrom) {
                    break;
                }
            }
            listStartLineLookup--;
        }
        if (listStartLine === null) {
            return null;
        }
        let listEndLine = listLookingPos;
        let listEndLineLookup = listLookingPos;
        while (listEndLineLookup <= editor.lastLine()) {
            const line = editor.getLine(listEndLineLookup);
            if (!this.isListItem(line) && !this.isLineWithIndent(line)) {
                break;
            }
            if (!this.isEmptyLine(line)) {
                listEndLine = listEndLineLookup;
            }
            if (listEndLineLookup >= limitTo) {
                listEndLine = limitTo;
                break;
            }
            listEndLineLookup++;
        }
        if (listStartLine > parsingStartLine || listEndLine < parsingStartLine) {
            return null;
        }
        // if the last line contains only spaces and that's incorrect indent, then ignore the last line
        // https://github.com/vslinko/obsidian-outliner/issues/368
        if (listEndLine > listStartLine) {
            const lastLine = editor.getLine(listEndLine);
            if (lastLine.trim().length === 0) {
                const prevLine = editor.getLine(listEndLine - 1);
                const [, prevLineIndent] = /^(\s*)/.exec(prevLine);
                if (!lastLine.startsWith(prevLineIndent)) {
                    listEndLine--;
                }
            }
        }
        const root = new Root({ line: listStartLine, ch: 0 }, { line: listEndLine, ch: editor.getLine(listEndLine).length }, editor.listSelections().map((r) => ({
            anchor: { line: r.anchor.line, ch: r.anchor.ch },
            head: { line: r.head.line, ch: r.head.ch },
        })));
        let currentParent = root.getRootList();
        let currentList = null;
        let currentIndent = "";
        const foldedLines = editor.getAllFoldedLines();
        for (let l = listStartLine; l <= listEndLine; l++) {
            const line = editor.getLine(l);
            const matches = parseListItemRe.exec(line);
            if (matches) {
                const [, indent, bullet, spaceAfterBullet] = matches;
                let [, , , , optionalCheckbox, content] = matches;
                content = optionalCheckbox + content;
                if (this.keepCursorWithinContent !== "bullet-and-checkbox") {
                    optionalCheckbox = "";
                }
                const compareLength = Math.min(currentIndent.length, indent.length);
                const indentSlice = indent.slice(0, compareLength);
                const currentIndentSlice = currentIndent.slice(0, compareLength);
                if (indentSlice !== currentIndentSlice) {
                    const expected = currentIndentSlice
                        .replace(/ /g, "S")
                        .replace(/\t/g, "T");
                    const got = indentSlice.replace(/ /g, "S").replace(/\t/g, "T");
                    return error(`Unable to parse list: expected indent "${expected}", got "${got}"`);
                }
                if (indent.length > currentIndent.length) {
                    currentParent = currentList;
                    currentIndent = indent;
                }
                else if (indent.length < currentIndent.length) {
                    while (currentParent.getFirstLineIndent().length >= indent.length &&
                        currentParent.getParent()) {
                        currentParent = currentParent.getParent();
                    }
                    currentIndent = indent;
                }
                const foldRoot = foldedLines.includes(l);
                currentList = new List(root, indent, bullet, optionalCheckbox, spaceAfterBullet, content, foldRoot);
                currentParent.addAfterAll(currentList);
            }
            else if (this.isLineWithIndent(line)) {
                if (!currentList) {
                    return error(`Unable to parse list: expected list item, got empty line`);
                }
                const indentToCheck = currentList.getNotesIndent() || currentIndent;
                if (line.indexOf(indentToCheck) !== 0) {
                    const expected = indentToCheck.replace(/ /g, "S").replace(/\t/g, "T");
                    const got = line
                        .match(/^[ \t]*/)[0]
                        .replace(/ /g, "S")
                        .replace(/\t/g, "T");
                    return error(`Unable to parse list: expected indent "${expected}", got "${got}"`);
                }
                if (!currentList.getNotesIndent()) {
                    const matches = line.match(/^[ \t]+/);
                    if (!matches || matches[0].length <= currentIndent.length) {
                        if (/^\s+$/.test(line)) {
                            continue;
                        }
                        return error(`Unable to parse list: expected some indent, got no indent`);
                    }
                    currentList.setNotesIndent(matches[0]);
                }
                currentList.addLine(line.slice(currentList.getNotesIndent().length));
            }
            else {
                return error(`Unable to parse list: expected list item or note, got "${line}"`);
            }
        }
        return root;
    }
    isEmptyLine(line) {
        return line.length === 0;
    }
    isLineWithIndent(line) {
        return stringWithSpacesRe.test(line);
    }
    isListItem(line) {
        return listItemRe.test(line);
    }
    isListItemWithoutSpaces(line) {
        return listItemWithoutSpacesRe.test(line);
    }
}

const VERTICAL_LINES_BODY_CLASS = "qes-outliner-vertical-lines";
class VerticalLinesPluginValue {
    constructor(settings, obsidianSettings, parser, view) {
        this.settings = settings;
        this.obsidianSettings = obsidianSettings;
        this.parser = parser;
        this.view = view;
        this.lineElements = [];
        this.waitForEditor = () => {
            const editor = getEditorFromState(this.view.state);
            if (!editor) {
                setTimeout(this.waitForEditor, 0);
                return;
            }
            this.editor = editor;
            this.scheduleRecalculate();
        };
        this.onScroll = (e) => {
            const { scrollLeft, scrollTop } = e.target;
            this.scroller.scrollTo(scrollLeft, scrollTop);
        };
        this.scheduleRecalculate = () => {
            clearTimeout(this.scheduled);
            this.scheduled = setTimeout(this.calculate, 0);
        };
        this.calculate = () => {
            this.lines = [];
            if (this.settings.verticalLines &&
                this.view.viewportLineBlocks.length > 0 &&
                this.view.visibleRanges.length > 0) {
                const fromLine = this.editor.offsetToPos(this.view.viewport.from).line;
                const toLine = this.editor.offsetToPos(this.view.viewport.to).line;
                const lists = this.parser.parseRange(this.editor, fromLine, toLine);
                for (const list of lists) {
                    this.lastLine = list.getContentEnd().line;
                    for (const c of list.getChildren()) {
                        this.recursive(c);
                    }
                }
                this.lines.sort((a, b) => a.top === b.top ? a.left - b.left : a.top - b.top);
            }
            this.updateDom();
        };
        this.onClick = (e) => {
            e.preventDefault();
            const line = this.lines[Number(e.target.dataset.index)];
            switch (this.settings.verticalLinesAction) {
                case "toggle-folding":
                    this.toggleFolding(line);
                    break;
            }
        };
        this.view.scrollDOM.addEventListener("scroll", this.onScroll);
        this.settings.onChange(this.scheduleRecalculate);
        this.prepareDom();
        this.waitForEditor();
    }
    prepareDom() {
        this.contentContainer = document.createElement("div");
        this.contentContainer.classList.add("qes-outliner-list-lines-content-container");
        this.scroller = document.createElement("div");
        this.scroller.classList.add("qes-outliner-list-lines-scroller");
        this.scroller.appendChild(this.contentContainer);
        this.view.dom.appendChild(this.scroller);
    }
    update(update) {
        if (update.docChanged ||
            update.viewportChanged ||
            update.geometryChanged ||
            update.transactions.some((tr) => tr.reconfigured)) {
            this.scheduleRecalculate();
        }
    }
    getNextSibling(list) {
        let listTmp = list;
        let p = listTmp.getParent();
        while (p) {
            const nextSibling = p.getNextSiblingOf(listTmp);
            if (nextSibling) {
                return nextSibling;
            }
            listTmp = p;
            p = listTmp.getParent();
        }
        return null;
    }
    recursive(list, parentCtx = {}) {
        const children = list.getChildren();
        if (children.length === 0) {
            return;
        }
        const fromOffset = this.editor.posToOffset({
            line: list.getFirstLineContentStart().line,
            ch: list.getFirstLineIndent().length,
        });
        const nextSibling = this.getNextSibling(list);
        const tillOffset = this.editor.posToOffset({
            line: nextSibling
                ? nextSibling.getFirstLineContentStart().line - 1
                : this.lastLine,
            ch: 0,
        });
        const visibleFrom = this.view.visibleRanges[0].from;
        const visibleTo = this.view.visibleRanges[this.view.visibleRanges.length - 1].to;
        if (fromOffset > visibleTo || tillOffset < visibleFrom) {
            return;
        }
        const coords = this.view.coordsAtPos(fromOffset, 1);
        if (parentCtx.rootLeft === undefined) {
            parentCtx.rootLeft = coords.left;
        }
        const left = Math.floor(coords.right - parentCtx.rootLeft);
        const top = visibleFrom > 0 && fromOffset < visibleFrom
            ? -20
            : this.view.lineBlockAt(fromOffset).top;
        const bottom = tillOffset > visibleTo
            ? this.view.lineBlockAt(visibleTo - 1).bottom
            : this.view.lineBlockAt(tillOffset).bottom;
        const height = bottom - top;
        if (height > 0 && !list.isFolded()) {
            const nextSibling = list.getParent().getNextSiblingOf(list);
            const hasNextSibling = !!nextSibling &&
                this.editor.posToOffset(nextSibling.getFirstLineContentStart()) <=
                    visibleTo;
            this.lines.push({
                top,
                left,
                height: `calc(${height}px ${hasNextSibling ? "- 1.5em" : "- 2em"})`,
                list,
            });
        }
        for (const child of children) {
            if (!child.isEmpty()) {
                this.recursive(child, parentCtx);
            }
        }
    }
    toggleFolding(line) {
        const { list } = line;
        if (list.isEmpty()) {
            return;
        }
        let needToUnfold = true;
        const linesToToggle = [];
        for (const c of list.getChildren()) {
            if (c.isEmpty()) {
                continue;
            }
            if (!c.isFolded()) {
                needToUnfold = false;
            }
            linesToToggle.push(c.getFirstLineContentStart().line);
        }
        const editor = getEditorFromState(this.view.state);
        for (const l of linesToToggle) {
            if (needToUnfold) {
                editor.unfold(l);
            }
            else {
                editor.fold(l);
            }
        }
    }
    updateDom() {
        const cmScroll = this.view.scrollDOM;
        const cmContent = this.view.contentDOM;
        const cmContentContainer = cmContent.parentElement;
        const cmSizer = cmContentContainer.parentElement;
        /**
         * Obsidian can add additional elements into Content Manager.
         * The most obvious case is the 'embedded-backlinks' core plugin that adds a menu inside a Content Manager.
         * We must take heights of all of these elements into account
         * to be able to calculate the correct size of lines' container.
         */
        let cmSizerChildrenSumHeight = 0;
        for (let i = 0; i < cmSizer.children.length; i++) {
            cmSizerChildrenSumHeight += cmSizer.children[i].clientHeight;
        }
        this.scroller.style.top = cmScroll.offsetTop + "px";
        this.contentContainer.style.height = cmSizerChildrenSumHeight + "px";
        this.contentContainer.style.marginLeft =
            cmContentContainer.offsetLeft + "px";
        this.contentContainer.style.marginTop =
            cmContent.firstElementChild.offsetTop - 24 + "px";
        for (let i = 0; i < this.lines.length; i++) {
            if (this.lineElements.length === i) {
                const e = document.createElement("div");
                e.classList.add("qes-outliner-list-line");
                e.dataset.index = String(i);
                e.addEventListener("mousedown", this.onClick);
                this.contentContainer.appendChild(e);
                this.lineElements.push(e);
            }
            const l = this.lines[i];
            const e = this.lineElements[i];
            e.style.top = l.top + "px";
            e.style.left = l.left + "px";
            e.style.height = l.height;
            e.style.display = "block";
        }
        for (let i = this.lines.length; i < this.lineElements.length; i++) {
            const e = this.lineElements[i];
            e.style.top = "0px";
            e.style.left = "0px";
            e.style.height = "0px";
            e.style.display = "none";
        }
    }
    destroy() {
        this.settings.removeCallback(this.scheduleRecalculate);
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.view.dom.removeChild(this.scroller);
        clearTimeout(this.scheduled);
    }
}
class VerticalLines {
    constructor(plugin, settings, obsidianSettings, parser) {
        this.plugin = plugin;
        this.settings = settings;
        this.obsidianSettings = obsidianSettings;
        this.parser = parser;
        this.updateBodyClass = () => {
            const shouldExists = this.settings.verticalLines;
            const exists = document.body.classList.contains(VERTICAL_LINES_BODY_CLASS);
            if (shouldExists && !exists) {
                document.body.classList.add(VERTICAL_LINES_BODY_CLASS);
            }
            if (!shouldExists && exists) {
                document.body.classList.remove(VERTICAL_LINES_BODY_CLASS);
            }
        };
    }
    async load() {
        this.updateBodyClass();
        this.updateBodyClassInterval = window.setInterval(() => {
            this.updateBodyClass();
        }, 1000);
        this.plugin.registerEditorExtension(view.ViewPlugin.define((view) => new VerticalLinesPluginValue(this.settings, this.obsidianSettings, this.parser, view)));
    }
    async unload() {
        clearInterval(this.updateBodyClassInterval);
        document.body.classList.remove(VERTICAL_LINES_BODY_CLASS);
    }
}

const SETTINGS_VERSION = 2;
// A value no longer offered (Outliner's "zoom-in") falls back to the default when loaded.
const VERTICAL_LINES_ACTIONS = ["none", "toggle-folding"];
const DEFAULT_SETTINGS = {
    version: SETTINGS_VERSION,
    rules: getDefaultSelectionRules(),
    sentenceMarkers: DEFAULT_SENTENCE_MARKERS,
    dragAndDrop: true,
    verticalLines: true,
    verticalLinesAction: "toggle-folding",
    wrapCoreCommands: true,
    insertPosition: "append",
    insertToggleHotkey: DEFAULT_INSERT_TOGGLE_HOTKEY,
    cursorAfterMove: "stay"
};
// Rules whose meaning changed in V2 (they became opt-in fine-grained steps), so values saved by
// the original plugin are not carried over.
const V1_ONLY_RULES = ["whitespace", "punctuation", "line"];
class QuickExpandSelectionPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
        this.historyByEditor = new WeakMap();
        this.settingsCallbacks = new Set();
        this.features = [];
        this.coreCommandsWrapped = false;
        /** The view of these settings that the features adapted from Outliner read. */
        this.outlinerSettings = ((plugin) => ({
            get dragAndDrop() { return plugin.settings.dragAndDrop; },
            get verticalLines() { return plugin.settings.verticalLines; },
            get verticalLinesAction() { return plugin.settings.verticalLinesAction; },
            onChange: (callback) => { plugin.settingsCallbacks.add(callback); },
            removeCallback: (callback) => { plugin.settingsCallbacks.delete(callback); }
        }))(this);
    }
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new QuickExpandSelectionSettingTab(this.app, this));
        const strings = getLocaleStrings();
        this.addCommand({
            id: "expand-selection",
            name: strings.commands.expandSelection,
            repeatable: true,
            hotkeys: [{ modifiers: ["Mod"], key: "a" }],
            editorCallback: (editor) => this.expand(editor)
        });
        this.addCommand({
            id: "shrink-selection",
            name: strings.commands.shrinkSelection,
            repeatable: true,
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
            editorCallback: (editor) => this.shrink(editor)
        });
        this.addCommand({
            id: "move-selection-to-note-heading",
            name: strings.commands.moveToHeading,
            icon: "heading",
            editorCallback: (editor) => void this.moveSelectionToHeading(editor)
        });
        this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
            if (!editor.somethingSelected())
                return;
            menu.addItem((item) => item
                .setTitle(strings.commands.moveToHeading)
                .setIcon("heading")
                .onClick(() => void this.moveSelectionToHeading(editor)));
        }));
        this.applyCoreCommandWrappers();
        const obsidianSettings = new ObsidianSettings(this.app);
        const parser = new Parser();
        const operationPerformer = new OperationPerformer(parser, new ChangesApplicator());
        this.features = [
            new VerticalLines(this, this.outlinerSettings, obsidianSettings, parser),
            new DragAndDrop(this, this.outlinerSettings, obsidianSettings, parser, operationPerformer)
        ];
        for (const feature of this.features)
            await feature.load();
    }
    async onunload() {
        // WeakMap history is released with its editor instances.
        for (const feature of this.features)
            await feature.unload();
    }
    async loadSettings() {
        const saved = (await this.loadData());
        const savedRules = { ...(saved?.rules ?? {}) };
        if ((saved?.version ?? 1) < SETTINGS_VERSION) {
            for (const rule of V1_ONLY_RULES)
                delete savedRules[rule];
        }
        const rules = getDefaultSelectionRules();
        for (const key of Object.keys(rules)) {
            if (typeof savedRules[key] === "boolean")
                rules[key] = savedRules[key];
        }
        this.settings = {
            version: SETTINGS_VERSION,
            rules,
            sentenceMarkers: typeof saved?.sentenceMarkers === "string" ? saved.sentenceMarkers : DEFAULT_SENTENCE_MARKERS,
            dragAndDrop: typeof saved?.dragAndDrop === "boolean" ? saved.dragAndDrop : DEFAULT_SETTINGS.dragAndDrop,
            verticalLines: typeof saved?.verticalLines === "boolean" ? saved.verticalLines : DEFAULT_SETTINGS.verticalLines,
            verticalLinesAction: VERTICAL_LINES_ACTIONS.includes(saved?.verticalLinesAction)
                ? saved?.verticalLinesAction
                : DEFAULT_SETTINGS.verticalLinesAction,
            wrapCoreCommands: typeof saved?.wrapCoreCommands === "boolean" ? saved.wrapCoreCommands : DEFAULT_SETTINGS.wrapCoreCommands,
            insertPosition: saved?.insertPosition === "prepend" ? "prepend" : "append",
            insertToggleHotkey: typeof saved?.insertToggleHotkey === "string" && parseHotkey(saved.insertToggleHotkey)
                ? saved.insertToggleHotkey
                : DEFAULT_INSERT_TOGGLE_HOTKEY,
            cursorAfterMove: saved?.cursorAfterMove === "follow" ? "follow" : "stay"
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
        this.applyCoreCommandWrappers();
        for (const callback of this.settingsCallbacks)
            callback();
    }
    applyCoreCommandWrappers() {
        if (this.settings.wrapCoreCommands === this.coreCommandsWrapped)
            return;
        if (this.settings.wrapCoreCommands)
            registerCoreCommandWrappers(this);
        else
            removeCoreCommandWrappers(this);
        this.coreCommandsWrapped = this.settings.wrapCoreCommands;
    }
    async moveSelectionToHeading(editor) {
        const strings = getLocaleStrings().move;
        const text = editor.getValue();
        const range = getSelectionRange(this.getSelectionState(editor, text));
        if (range.from === range.to) {
            new obsidian.Notice(strings.nothingSelected);
            return;
        }
        const headings = movableTargets(text, range);
        if (headings.length === 0) {
            new obsidian.Notice(strings.noHeadings);
            return;
        }
        if (!isWholeLineSelection(text, range) && !(await confirmPartialMove(this.app, strings)))
            return;
        new HeadingSwitcherModal(this.app, {
            headings,
            position: this.settings.insertPosition,
            toggleHotkey: parseHotkey(this.settings.insertToggleHotkey),
            strings,
            onPositionChange: (position) => {
                this.settings.insertPosition = position;
                void this.saveSettings();
            },
            onChoose: (heading, position) => {
                if (editor.getValue() !== text) {
                    new obsidian.Notice(strings.noteChanged);
                    return;
                }
                const plan = planMove(text, range, heading.line, position);
                if (!plan)
                    return;
                editor.transaction({
                    changes: plan.changes.map((change) => ({
                        from: editor.offsetToPos(change.from),
                        to: editor.offsetToPos(change.to),
                        text: change.insert
                    }))
                });
                if (this.settings.cursorAfterMove === "follow") {
                    const from = editor.offsetToPos(plan.moved.from);
                    const to = editor.offsetToPos(plan.moved.to);
                    editor.setSelection(from, to);
                    editor.scrollIntoView({ from, to }, true);
                }
                else {
                    editor.setCursor(editor.offsetToPos(plan.removedAt));
                }
            }
        }).open();
    }
    clearSelectionHistory() {
        const editor = this.getActiveEditor();
        if (editor)
            this.historyByEditor.delete(editor);
        new obsidian.Notice(getLocaleStrings().notices.expansionHistoryReset);
    }
    getActiveEditor() {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        return view?.editor ?? null;
    }
    getText(editor) {
        return editor.getValue();
    }
    getSelectionState(editor, text) {
        return {
            anchor: positionToOffset(text, editor.getCursor("anchor")),
            head: positionToOffset(text, editor.getCursor("head"))
        };
    }
    setSelection(editor, text, selection) {
        editor.setSelection(offsetToPosition(text, selection.anchor), offsetToPosition(text, selection.head));
    }
    ensureHistory(editor, text, current) {
        const existing = this.historyByEditor.get(editor);
        const range = getSelectionRange(current);
        const existingCurrent = existing?.selections.at(-1);
        if (!existing || existing.text !== text || !existingCurrent || getSelectionRange(existingCurrent).from !== range.from || getSelectionRange(existingCurrent).to !== range.to) {
            const history = { text, selections: [current] };
            this.historyByEditor.set(editor, history);
            return history;
        }
        return existing;
    }
    expand(editor) {
        const text = this.getText(editor);
        const current = this.getSelectionState(editor, text);
        const history = this.ensureHistory(editor, text, current);
        const nextRange = expandSelection(text, current, this.settings.rules, this.settings.sentenceMarkers);
        const next = current.anchor <= current.head
            ? { anchor: nextRange.from, head: nextRange.to }
            : { anchor: nextRange.to, head: nextRange.from };
        const previous = history.selections.at(-1);
        if (!previous || previous.anchor !== next.anchor || previous.head !== next.head) {
            history.selections.push(next);
        }
        this.setSelection(editor, text, next);
    }
    shrink(editor) {
        const text = this.getText(editor);
        const current = this.getSelectionState(editor, text);
        const history = this.ensureHistory(editor, text, current);
        const next = shrinkSelection(history.selections.slice(0, -1), current);
        if (history.selections.length > 1)
            history.selections.pop();
        this.setSelection(editor, text, next);
    }
}

module.exports = QuickExpandSelectionPlugin;
