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

/** How the hotkey is shown to the user, e.g. `Alt+A` on Windows or `⌥A` on macOS. */
export function formatHotkey(hotkey: ParsedHotkey, isMac: boolean): string {
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
