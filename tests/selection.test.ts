import assert from "node:assert/strict";
import test from "node:test";
import {
  expandSelection,
  getDefaultSelectionRules,
  getSelectionRange,
  offsetToPosition,
  positionToOffset,
  shrinkSelection,
  type SelectionRules,
  type SelectionState
} from "../src/selection";
import type { TextRange } from "../src/selection";

const allRules: SelectionRules = {
  list: true,
  heading: true,
  sentence: true,
  code: true,
  latex: true,
  whitespace: true,
  punctuation: true,
  pairs: true,
  token: true,
  line: true
};

const defaultRules = getDefaultSelectionRules();

function selected(text: string, selection: SelectionState | TextRange): string {
  const range = "anchor" in selection ? getSelectionRange(selection) : selection;
  return text.slice(range.from, range.to);
}

function at(text: string, fragment: string, occurrence = 0): SelectionState {
  let from = -1;
  let searchFrom = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    from = text.indexOf(fragment, searchFrom);
    searchFrom = from + fragment.length;
  }
  assert.notEqual(from, -1, `fragment not found: ${fragment}`);
  return { anchor: from, head: from + fragment.length };
}

function cursor(text: string, fragment: string, occurrence = 0): SelectionState {
  const { anchor } = at(text, fragment, occurrence);
  return { anchor, head: anchor };
}

/** Every selection produced by pressing expand repeatedly until nothing grows. */
function ladder(text: string, start: SelectionState, rules: Partial<SelectionRules> = defaultRules): string[] {
  const steps: string[] = [];
  let current = start;
  for (let press = 0; press < 30; press += 1) {
    const next = expandSelection(text, current, rules);
    const range = getSelectionRange(current);
    if (next.from === range.from && next.to === range.to) break;
    steps.push(text.slice(next.from, next.to));
    current = { anchor: next.from, head: next.to };
  }
  return steps;
}

const note = [
  "# Top",
  "Intro line.",
  "",
  "## Section",
  "First sentence here. Second one follows! Third?",
  "",
  "- parent",
  "  - child one",
  "    - grandchild",
  "  - child two",
  "- sibling",
  "",
  "### Sub",
  "sub text",
  "",
  "## Next",
  "next text"
].join("\n");

const section = note.slice(note.indexOf("## Section"), note.indexOf("\n\n## Next") + 1);

test("paragraph: word, sentence, paragraph, then heading sections and the note", () => {
  assert.deepEqual(ladder(note, cursor(note, "one follows")), [
    "one",
    "Second one follows!",
    "First sentence here. Second one follows! Third?",
    section,
    note
  ]);
});

test("list item: word, bullet line, bullet with children, parents, list, then headings", () => {
  const list = "- parent\n  - child one\n    - grandchild\n  - child two\n- sibling";
  assert.deepEqual(ladder(note, cursor(note, "one\n")), [
    "one",
    "  - child one",
    "  - child one\n    - grandchild",
    "- parent\n  - child one\n    - grandchild\n  - child two",
    list,
    section,
    note
  ]);
});

test("heading: word, heading line, section, parent sections, note", () => {
  assert.deepEqual(ladder(note, cursor(note, "Sub")), [
    "Sub",
    "### Sub",
    "### Sub\nsub text\n",
    section,
    note
  ]);
});

test("a section ends at the next heading of the same or higher level", () => {
  const text = "# Title\nintro\n## Child\nchild text\n# Next";
  assert.deepEqual(ladder(text, cursor(text, "Title")).slice(0, 3), [
    "Title",
    "# Title",
    "# Title\nintro\n## Child\nchild text"
  ]);
});

test("text with no heading above goes from paragraph straight to the note", () => {
  const text = "Alpha beta. Gamma.\n\n- item\n\n# Later";
  assert.deepEqual(ladder(text, cursor(text, "beta")), ["beta", "Alpha beta.", "Alpha beta. Gamma.", text]);
});

test("whole list bridges blank lines and includes indented continuations", () => {
  const text = "# H\n- one\n  continued\n\n- two\n    - deep\n\nAfter.";
  const steps = ladder(text, cursor(text, "deep"));
  assert.ok(steps.includes("- one\n  continued\n\n- two\n    - deep"), steps.join(" | "));
});

test("headings inside code blocks are ignored", () => {
  const text = "# Real\n```\n# not a heading\n```\nafter";
  assert.deepEqual(ladder(text, cursor(text, "after")), ["after", text]);
});

test("sentence markers are configurable and full-width markers need no space", () => {
  const text = "# H\n写作很重要。下一句。";
  assert.deepEqual(ladder(text, cursor(text, "下一句")).slice(0, 2), ["下一句", "下一句。"]);
  const custom = "# H\none; two; three";
  assert.deepEqual(ladder(custom, cursor(custom, "two")).slice(0, 2), ["two", "one; two; three"]);
  const next = expandSelection(custom, at(custom, "two"), defaultRules, ";");
  assert.equal(selected(custom, next), "two;");
});

test("extra steps are off by default and can be enabled", () => {
  const text = "# H\nSee **bold words** here.";
  assert.equal(ladder(text, cursor(text, "words"))[1], "See **bold words** here.");
  const withPairs = ladder(text, cursor(text, "words"), { ...defaultRules, pairs: true });
  assert.equal(withPairs[1], "**bold words**");
});

test("disabled list and heading rules are respected", () => {
  const text = "# Title\n- item\n- other";
  const noList = ladder(text, cursor(text, "item"), { ...defaultRules, list: false });
  assert.equal(noList[1], "- item\n- other");
  const noHeading = ladder(text, cursor(text, "Title"), { ...defaultRules, heading: false });
  assert.deepEqual(noHeading, ["Title", "# Title", text]);
});

test("whitespace toggle adds a step over neighbouring spaces", () => {
  const text = "one two";
  const word = at(text, "one");
  const withWhitespace = expandSelection(text, word, allRules);
  const withoutWhitespace = expandSelection(text, word, defaultRules);
  assert.equal(selected(text, withWhitespace), "one ");
  assert.equal(selected(text, withoutWhitespace), "one two");
});

test("expands code content before the whole fenced code block", () => {
  const text = "```ts\nconst value = fn(arg);\n```";
  const word = at(text, "value");
  const line = expandSelection(text, word, allRules);
  const fence = expandSelection(text, { anchor: line.from, head: line.to }, allRules);
  assert.equal(selected(text, line), "const value = fn(arg);");
  assert.equal(selected(text, fence), text);
});

test("uses IDE-like delimiter levels inside code", () => {
  const text = "```js\nconst value = fn(arg);\n```";
  const argument = at(text, "arg");
  const pair = expandSelection(text, argument, allRules);
  const line = expandSelection(text, { anchor: pair.from, head: pair.to }, allRules);
  assert.equal(selected(text, pair), "(arg)");
  assert.equal(selected(text, line), "const value = fn(arg);");
});

test("code blocks chain into heading sections", () => {
  const text = "# H\n## Sub\n```\ncode\n```\n# Other";
  const steps = ladder(text, cursor(text, "code"));
  assert.deepEqual(steps, ["code", "```\ncode\n```", "## Sub\n```\ncode\n```", "# H\n## Sub\n```\ncode\n```", text]);
});

test("expands inline and block LaTeX", () => {
  const inline = "公式 $a + b$ 很有用";
  const inlineContent = at(inline, "a + b");
  const inlineMath = expandSelection(inline, inlineContent, allRules);
  assert.equal(selected(inline, inlineMath), "$a + b$");

  const block = "\\[\nx^2 + y^2\n\\]";
  const blockContent = at(block, "x^2 + y^2");
  const blockMath = expandSelection(block, blockContent, allRules);
  assert.equal(selected(block, blockMath), block);

  const nested = "$$\\frac{a}{b}$$";
  const numerator = at(nested, "a", 1);
  const fraction = expandSelection(nested, numerator, allRules);
  assert.equal(selected(nested, fraction), "{a}");
});

test("shrink returns the prior selection and then collapses the cursor", () => {
  const history: SelectionState[] = [
    { anchor: 4, head: 8 },
    { anchor: 0, head: 12 },
    { anchor: 0, head: 20 }
  ];
  assert.deepEqual(shrinkSelection(history.slice(0, -1), history[2]), history[1]);
  assert.deepEqual(shrinkSelection([], history[0]), { anchor: 8, head: 8 });
});

test("converts between line/ch positions and offsets", () => {
  const text = "ab\n中文";
  assert.equal(positionToOffset(text, { line: 1, ch: 1 }), 4);
  assert.deepEqual(offsetToPosition(text, 4), { line: 1, ch: 1 });
});

test("extra steps work on bullet and heading lines", () => {
  const text = "# Title (draft)\n- see (the note) here";
  const rules = { ...defaultRules, pairs: true };
  assert.equal(ladder(text, cursor(text, "note"), rules)[1], "(the note)");
  assert.equal(ladder(text, cursor(text, "draft"), rules)[1], "(draft)");
});
