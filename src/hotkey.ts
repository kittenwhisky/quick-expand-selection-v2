/** A hotkey typed as text in the settings, such as `Alt+A` or `Mod+Shift+P`. */
export interface ParsedHotkey {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** The key in lower case, e.g. `a`, `1`, `f2`, `arrowup`. */
  key: string;
}

const MODIFIER_ALIASES: Record<string, keyof Omit<ParsedHotkey, "key">> = {
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
export function parseHotkey(text: string): ParsedHotkey | null {
  const parts = text.split("+").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const hotkey: ParsedHotkey = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: "" };
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      hotkey[modifier] = true;
    } else if (hotkey.key) {
      return null;
    } else {
      hotkey.key = part.toLowerCase();
    }
  }
  return hotkey.key ? hotkey : null;
}

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Letters and digits are matched by physical key (`KeyA`, `Digit1`), because with Alt/Option held
 * macOS reports a different character (Option+A gives `å`).
 */
export function matchesHotkey(hotkey: ParsedHotkey, event: KeyEventLike, isMac: boolean): boolean {
  const wantCtrl = hotkey.ctrl || (hotkey.mod && !isMac);
  const wantMeta = hotkey.meta || (hotkey.mod && isMac);
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== hotkey.alt || event.shiftKey !== hotkey.shift) {
    return false;
  }
  if (/^[a-z]$/u.test(hotkey.key)) return event.code === `Key${hotkey.key.toUpperCase()}`;
  if (/^[0-9]$/u.test(hotkey.key)) return event.code === `Digit${hotkey.key}`;
  return event.key.toLowerCase() === hotkey.key;
}

/** An Obsidian hotkey (`{ modifiers: ["Mod"], key: "ArrowUp" }`) in this module's form. */
export function fromObsidianHotkey(hotkey: { modifiers: string[]; key: string }): ParsedHotkey | null {
  const parts = [...hotkey.modifiers, hotkey.key];
  return parseHotkey(parts.join("+"));
}

const KEY_NAMES: Record<string, string> = {
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  pageup: "PageUp",
  pagedown: "PageDown",
  backspace: "Backspace",
  delete: "Delete",
  enter: "Enter",
  escape: "Escape",
  home: "Home",
  end: "End",
  insert: "Insert",
  tab: "Tab"
};

/** This module's form back to Obsidian's (`{ modifiers: ["Alt"], key: "A" }`), for `Scope.register`. */
export function toObsidianHotkey(hotkey: ParsedHotkey): { modifiers: Array<"Mod" | "Ctrl" | "Meta" | "Alt" | "Shift">; key: string } {
  const modifiers: Array<"Mod" | "Ctrl" | "Meta" | "Alt" | "Shift"> = [];
  if (hotkey.mod) modifiers.push("Mod");
  if (hotkey.ctrl) modifiers.push("Ctrl");
  if (hotkey.meta) modifiers.push("Meta");
  if (hotkey.alt) modifiers.push("Alt");
  if (hotkey.shift) modifiers.push("Shift");
  const key = KEY_NAMES[hotkey.key]
    ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key.charAt(0).toUpperCase() + hotkey.key.slice(1));
  return { modifiers, key };
}

const KEY_SYMBOLS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "↵",
  escape: "Esc",
  " ": "Space"
};

/** How the hotkey is shown to the user, e.g. `Alt+A` on Windows or `⌥A` on macOS. */
export function formatHotkey(hotkey: ParsedHotkey, isMac: boolean): string {
  const key = KEY_SYMBOLS[hotkey.key]
    ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key.charAt(0).toUpperCase() + hotkey.key.slice(1));
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
