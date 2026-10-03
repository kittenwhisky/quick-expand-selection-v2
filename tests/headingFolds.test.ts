import assert from "node:assert/strict";
import test from "node:test";
import { foldAll, foldLess, foldMore, subheadingCount, unfoldAll, visibleHeadings } from "../src/headingFolds";
import { listHeadings } from "../src/selection";

const headings = listHeadings([
  "# Project",
  "## Tasks",
  "### Today",
  "### Later",
  "#### Someday",
  "## Notes",
  "# Archive"
].join("\n"));

const line = (text: string): number => {
  const heading = headings.find((candidate) => candidate.text === text);
  assert.ok(heading, text);
  return heading.line;
};

const shown = (folded: Set<number>): string[] => visibleHeadings(headings, folded).map((heading) => heading.text);

test("counts subheadings at any depth", () => {
  assert.equal(subheadingCount(headings, 0), 5);
  assert.equal(subheadingCount(headings, 1), 3);
  assert.equal(subheadingCount(headings, 2), 0);
});

test("fold more hides the highlighted heading's subheadings", () => {
  const folded = new Set<number>();
  assert.equal(foldMore(headings, folded, line("Tasks")), line("Tasks"));
  assert.deepEqual(shown(folded), ["Project", "Tasks", "Notes", "Archive"]);
});

test("fold more on a heading with no subheadings, or already folded, folds its parent", () => {
  const folded = new Set<number>();
  assert.equal(foldMore(headings, folded, line("Today")), line("Tasks"));
  assert.deepEqual(shown(folded), ["Project", "Tasks", "Notes", "Archive"]);
  assert.equal(foldMore(headings, folded, line("Tasks")), line("Project"));
  assert.deepEqual(shown(folded), ["Project", "Archive"]);
});

test("fold more on a top-level heading without subheadings does nothing", () => {
  const folded = new Set<number>();
  assert.equal(foldMore(headings, folded, line("Archive")), line("Archive"));
  assert.equal(folded.size, 0);
});

test("fold less unfolds the heading, then its folded subheadings one level at a time", () => {
  const folded = new Set([line("Project"), line("Tasks"), line("Later")]);
  assert.deepEqual(shown(folded), ["Project", "Archive"]);
  foldLess(headings, folded, line("Project"));
  assert.deepEqual(shown(folded), ["Project", "Tasks", "Notes", "Archive"]);
  foldLess(headings, folded, line("Project"));
  assert.deepEqual(shown(folded), ["Project", "Tasks", "Today", "Later", "Notes", "Archive"]);
  foldLess(headings, folded, line("Project"));
  assert.deepEqual(shown(folded), headings.map((heading) => heading.text));
});

test("fold all leaves the top level and highlights the containing heading; unfold all shows everything", () => {
  const folded = new Set<number>();
  assert.equal(foldAll(headings, folded, line("Someday")), line("Project"));
  assert.deepEqual(shown(folded), ["Project", "Archive"]);
  unfoldAll(folded);
  assert.deepEqual(shown(folded), headings.map((heading) => heading.text));
});
