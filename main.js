'use strict';

var obsidian = require('obsidian');

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
function getLines(text) {
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
    const lines = getLines(text);
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
    const lines = getLines(text);
    const line = clamp(position.line, 0, Math.max(0, lines.length - 1));
    const target = lines[line];
    return target.start + clamp(position.ch, 0, target.end - target.start);
}
function offsetToPosition(text, offset) {
    const safeOffset = clamp(offset, 0, text.length);
    const lines = getLines(text);
    const line = lineNumberAt(text, safeOffset);
    return { line, ch: safeOffset - lines[line].start };
}
function getDefaultSelectionRules() {
    return { ...DEFAULT_RULES };
}

const en = {
    commands: {
        expandSelection: "Expand selection",
        shrinkSelection: "Shrink selection"
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
    notices: {
        expansionHistoryReset: "Expansion history reset."
    }
};
const zhCn = {
    commands: {
        expandSelection: "扩选文本",
        shrinkSelection: "缩选文本"
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

const STRUCTURE_RULES = ["list", "heading", "sentence", "code", "latex"];
const EXTRA_STEP_RULES = ["whitespace", "punctuation", "pairs", "token", "line"];
const SENTENCE_MARKERS_KEY = "sentenceMarkers";
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
        return [
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
        if (key === SENTENCE_MARKERS_KEY)
            return this.plugin.settings.sentenceMarkers;
        const rule = this.getRuleKey(key);
        return rule ? this.plugin.settings.rules[rule] : undefined;
    }
    async setControlValue(key, value) {
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
    getRuleKey(key) {
        const prefix = "rules.";
        if (!key.startsWith(prefix))
            return null;
        const rule = key.slice(prefix.length);
        return Object.prototype.hasOwnProperty.call(getDefaultSelectionRules(), rule) ? rule : null;
    }
}

const SETTINGS_VERSION = 2;
const DEFAULT_SETTINGS = {
    version: SETTINGS_VERSION,
    rules: getDefaultSelectionRules(),
    sentenceMarkers: DEFAULT_SENTENCE_MARKERS
};
// Rules whose meaning changed in V2 (they became opt-in fine-grained steps), so values saved by
// the original plugin are not carried over.
const V1_ONLY_RULES = ["whitespace", "punctuation", "line"];
class QuickExpandSelectionPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
        this.historyByEditor = new WeakMap();
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
    }
    onunload() {
        // WeakMap history is released with its editor instances.
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
            sentenceMarkers: typeof saved?.sentenceMarkers === "string" ? saved.sentenceMarkers : DEFAULT_SENTENCE_MARKERS
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
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
