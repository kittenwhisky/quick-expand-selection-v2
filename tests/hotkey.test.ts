import assert from "node:assert/strict";
import test from "node:test";
import { formatHotkey, matchesHotkey, parseHotkey, type KeyEventLike } from "../src/hotkey";

function event(overrides: Partial<KeyEventLike>): KeyEventLike {
  return { key: "a", code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

test("parses modifiers and one key, case-insensitively", () => {
  assert.deepEqual(parseHotkey("Alt+A"), { mod: false, ctrl: false, meta: false, alt: true, shift: false, key: "a" });
  assert.deepEqual(parseHotkey(" mod + shift + p "), { mod: true, ctrl: false, meta: false, alt: false, shift: true, key: "p" });
  assert.equal(parseHotkey("Option+F2")?.key, "f2");
});

test("rejects text without exactly one key", () => {
  assert.equal(parseHotkey(""), null);
  assert.equal(parseHotkey("Alt"), null);
  assert.equal(parseHotkey("Alt+A+B"), null);
});

test("matches letters by physical key, so macOS Option characters still match", () => {
  const altA = parseHotkey("Alt+A");
  assert.ok(altA);
  assert.ok(matchesHotkey(altA, event({ altKey: true }), false));
  assert.ok(matchesHotkey(altA, event({ altKey: true, key: "å" }), true));
  assert.ok(!matchesHotkey(altA, event({}), false));
  assert.ok(!matchesHotkey(altA, event({ altKey: true, shiftKey: true }), false));
  assert.ok(!matchesHotkey(altA, event({ altKey: true, code: "KeyB", key: "b" }), false));
});

test("Mod means Ctrl on Windows and Cmd on macOS", () => {
  const modP = parseHotkey("Mod+P");
  assert.ok(modP);
  assert.ok(matchesHotkey(modP, event({ ctrlKey: true, key: "p", code: "KeyP" }), false));
  assert.ok(matchesHotkey(modP, event({ metaKey: true, key: "p", code: "KeyP" }), true));
  assert.ok(!matchesHotkey(modP, event({ ctrlKey: true, key: "p", code: "KeyP" }), true));
});

test("formats for display per platform", () => {
  const altA = parseHotkey("alt+a");
  assert.ok(altA);
  assert.equal(formatHotkey(altA, false), "Alt+A");
  assert.equal(formatHotkey(altA, true), "⌥A");
});
