import assert from "node:assert/strict";
import test from "node:test";
import { applyChanges, isWholeLineSelection, movableTargets, planMove, type InsertPosition } from "../src/moveToHeading";
import { listHeadings, type TextRange } from "../src/selection";

const note = [
  "# Inbox",
  "move me",
  "",
  "## Ideas",
  "first idea",
  "second idea",
  "",
  "### Sub",
  "sub text",
  "",
  "## Done"
].join("\n");

function range(text: string, fragment: string): TextRange {
  const from = text.indexOf(fragment);
  assert.notEqual(from, -1, fragment);
  return { from, to: from + fragment.length };
}

function lineOf(text: string, heading: string): number {
  return text.split("\n").indexOf(heading);
}

function move(text: string, selection: TextRange, heading: string, position: InsertPosition) {
  const plan = planMove(text, selection, lineOf(text, heading), position);
  assert.ok(plan, "expected a plan");
  const result = applyChanges(text, plan.changes);
  return { result, plan, moved: result.slice(plan.moved.from, plan.moved.to) };
}

test("lists headings with levels, ignoring code blocks and closing hashes", () => {
  const text = "# One\n```\n# not\n```\n## Two ##\n###### Six";
  assert.deepEqual(listHeadings(text), [
    { line: 0, level: 1, text: "One" },
    { line: 4, level: 2, text: "Two" },
    { line: 5, level: 6, text: "Six" }
  ]);
});

test("recognises whole-line selections", () => {
  assert.ok(isWholeLineSelection(note, range(note, "move me")));
  assert.ok(isWholeLineSelection(note, range(note, "move me\n")));
  assert.ok(!isWholeLineSelection(note, range(note, "move")));
  assert.ok(!isWholeLineSelection(note, range(note, "ove me")));
});

test("append goes after the heading's own text, before its first subheading", () => {
  const { result, moved } = move(note, range(note, "move me"), "## Ideas", "append");
  assert.equal(result, [
    "# Inbox",
    "",
    "## Ideas",
    "first idea",
    "second idea",
    "move me",
    "",
    "### Sub",
    "sub text",
    "",
    "## Done"
  ].join("\n"));
  assert.equal(moved, "move me");
});

test("prepend goes directly below the heading line", () => {
  const { result } = move(note, range(note, "move me"), "## Ideas", "prepend");
  assert.equal(result.split("\n").slice(1, 5).join("\n"), "\n## Ideas\nmove me\nfirst idea");
});

test("append under a heading with no text of its own goes directly below it", () => {
  const { result } = move(note, range(note, "move me"), "## Done", "append");
  assert.ok(result.endsWith("## Done\nmove me"), result);
});

test("moving downwards and upwards both keep the rest of the note intact", () => {
  const up = move(note, range(note, "sub text"), "# Inbox", "append");
  assert.equal(up.result.split("\n").slice(0, 3).join("\n"), "# Inbox\nmove me\nsub text");
  assert.ok(!up.result.includes("### Sub\nsub text"));
  assert.equal(up.moved, "sub text");
});

test("a partial selection moves exactly the selected text onto its own line", () => {
  const text = "# A\nkeep this and move this\n# B\nb";
  const { result, moved } = move(text, range(text, "move this"), "# B", "append");
  assert.equal(result, "# A\nkeep this and \n# B\nb\nmove this");
  assert.equal(moved, "move this");
});

test("multi-line selections move as a block", () => {
  const { result } = move(note, range(note, "first idea\nsecond idea"), "## Done", "prepend");
  assert.ok(result.endsWith("## Done\nfirst idea\nsecond idea"), result);
  assert.ok(result.includes("## Ideas\n\n### Sub"), result);
});

test("moving the last line of a note", () => {
  const text = "# A\na\n# B\nlast";
  const { result } = move(text, range(text, "last"), "# A", "append");
  assert.equal(result, "# A\na\nlast\n# B");
});

test("moving a heading's own last line to the same heading's append position", () => {
  const text = "# A\none\ntwo\n# B";
  const { result } = move(text, range(text, "two"), "# A", "append");
  assert.equal(result, text);
});

test("the cursor position after the move is where the text was removed", () => {
  const { result, plan } = move(note, range(note, "first idea\n"), "# Inbox", "prepend");
  assert.equal(result.slice(plan.removedAt, plan.removedAt + "second idea".length), "second idea");
});

test("headings inside the selection are not offered as targets", () => {
  const selection = range(note, "## Ideas\nfirst idea");
  assert.deepEqual(movableTargets(note, selection).map((heading) => heading.text), ["Inbox", "Sub", "Done"]);
  assert.equal(planMove(note, selection, lineOf(note, "## Ideas"), "append"), null);
});

test("an empty selection plans nothing", () => {
  assert.equal(planMove(note, { from: 3, to: 3 }, 0, "append"), null);
});
