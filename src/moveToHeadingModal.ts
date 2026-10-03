import { App, Modal, Platform, SuggestModal, ToggleComponent, prepareFuzzySearch, renderMatches, type SearchResult } from "obsidian";
import { foldAll, foldLess, foldMore, subheadingCount, unfoldAll, visibleAncestor, visibleHeadings } from "./headingFolds";
import { formatHotkey, matchesHotkey, toObsidianHotkey, type ParsedHotkey } from "./hotkey";
import type { CursorAfterMove, InsertPosition } from "./moveToHeading";
import type { HeadingLine } from "./selection";
import type { LocaleStrings } from "./i18n";

interface HeadingSuggestion {
  heading: HeadingLine;
  match: SearchResult | null;
}

export interface HeadingSwitcherOptions {
  headings: HeadingLine[];
  position: InsertPosition;
  toggleHotkey: ParsedHotkey | null;
  cursorAfterMove: CursorAfterMove;
  followHotkey: ParsedHotkey | null;
  /** Hotkeys assigned to the core fold commands (or V2's versions), reused inside the list. */
  foldHotkeys: Record<FoldAction, ParsedHotkey[]>;
  strings: LocaleStrings["move"];
  onPositionChange(position: InsertPosition): void;
  onCursorChange(cursor: CursorAfterMove): void;
  onChoose(heading: HeadingLine, position: InsertPosition, cursor: CursorAfterMove): void;
}

export type FoldAction = "foldMore" | "foldLess" | "foldAll" | "unfoldAll";
const FOLD_ACTIONS: FoldAction[] = ["foldMore", "foldLess", "foldAll", "unfoldAll"];

interface Chooser {
  selectedItem?: number;
  values?: HeadingSuggestion[] | null;
  suggestions?: HTMLElement[];
  setSelectedItem?(index: number, event: Event | null): void;
}

/**
 * "Left [toggle] Right (hotkey)": Obsidian's settings toggle with a clickable word on each side;
 * off (left) is the first value, on (right) the second. The active word is emphasised.
 */
class SideSwitch<T extends string> {
  private readonly toggle: ToggleComponent;
  private readonly labels = new Map<T, HTMLElement>();

  constructor(
    containerEl: HTMLElement,
    private readonly sides: readonly [T, T],
    texts: readonly [string, string],
    hotkey: ParsedHotkey | null,
    private value: T,
    private readonly onChange: (value: T) => void,
    afterClick: () => void
  ) {
    const el = containerEl.createDiv({ cls: "qes-move-switch" });
    const label = (side: T, text: string): void => {
      const labelEl = el.createSpan({ cls: "qes-move-position-label", text });
      labelEl.addEventListener("click", () => {
        this.set(side);
        afterClick();
      });
      this.labels.set(side, labelEl);
    };
    label(sides[0], texts[0]);
    this.toggle = new ToggleComponent(el).setValue(value === sides[1]).onChange((on) => {
      this.set(on ? sides[1] : sides[0]);
      afterClick();
    });
    this.toggle.toggleEl.setAttribute("aria-label", `${texts[0]} / ${texts[1]}`);
    label(sides[1], texts[1]);
    if (hotkey) el.createSpan({ cls: "qes-move-position-hotkey", text: `(${formatHotkey(hotkey, Platform.isMacOS)})` });
    this.render();
  }

  get(): T {
    return this.value;
  }

  flip(): void {
    this.set(this.value === this.sides[0] ? this.sides[1] : this.sides[0]);
  }

  private set(value: T): void {
    if (value === this.value) return;
    this.value = value;
    this.render();
    this.onChange(value);
  }

  private render(): void {
    const on = this.value === this.sides[1];
    if (this.toggle.getValue() !== on) this.toggle.setValue(on);
    for (const [side, labelEl] of this.labels) labelEl.toggleClass("is-active", side === this.value);
  }
}

/**
 * Quick-switcher-style list of the note's headings, with Prepend/Append and Stay/Follow toggles.
 */
export class HeadingSwitcherModal extends SuggestModal<HeadingSuggestion> {
  private positionSwitch: SideSwitch<InsertPosition> | null = null;
  private cursorSwitch: SideSwitch<CursorAfterMove> | null = null;
  /** Lines of the headings whose subheadings are hidden. The list opens fully unfolded. */
  private readonly folded = new Set<number>();
  /** Key presses already acted on, so the scope handler and the DOM fallback never both act. */
  private readonly handledKeys = new WeakSet<KeyboardEvent>();

  constructor(app: App, private readonly options: HeadingSwitcherOptions) {
    super(app);
    const { strings } = options;
    this.setPlaceholder(strings.placeholder);
    this.emptyStateText = strings.noMatch;
    this.limit = 1000;
    const foldInstructions = FOLD_ACTIONS.flatMap((action) => {
      const hotkey = options.foldHotkeys[action][0];
      return hotkey ? [{ command: formatHotkey(hotkey, Platform.isMacOS), purpose: strings[action] }] : [];
    });
    this.setInstructions([
      { command: "↑↓", purpose: strings.navigate },
      { command: "Tab", purpose: strings.autocomplete },
      { command: "↵", purpose: strings.move },
      ...foldInstructions,
      { command: "esc", purpose: strings.dismiss }
    ]);
    this.scope.register([], "Tab", () => {
      this.autocomplete();
      return false;
    });
    // Obsidian checks hotkeys at window level before the modal sees the key, and would otherwise
    // run e.g. the app-wide Fold more on the note behind. Registering in the modal's own scope
    // takes precedence while it is open, with Obsidian's own key matching.
    if (options.toggleHotkey) this.registerKey(options.toggleHotkey, () => this.positionSwitch?.flip());
    if (options.followHotkey) this.registerKey(options.followHotkey, () => this.cursorSwitch?.flip());
    for (const action of FOLD_ACTIONS) {
      for (const hotkey of options.foldHotkeys[action]) this.registerKey(hotkey, () => this.fold(action));
    }
    this.modalEl.addClass("qes-heading-switcher");
  }

  private registerKey(hotkey: ParsedHotkey, run: () => void): void {
    const { modifiers, key } = toObsidianHotkey(hotkey);
    this.scope.register(modifiers, key, (event) => {
      this.handleKey(event, run);
      return false;
    });
  }

  private handleKey(event: KeyboardEvent, run: () => void): void {
    if (this.handledKeys.has(event)) return;
    this.handledKeys.add(event);
    event.preventDefault();
    event.stopPropagation();
    run();
  }

  override onOpen(): void {
    void super.onOpen();
    this.renderToggles();
    this.modalEl.addEventListener("keydown", this.onKeyDown, true);
  }

  override onClose(): void {
    this.modalEl.removeEventListener("keydown", this.onKeyDown, true);
    super.onClose();
  }

  /**
   * Headings in note order. With an empty box, folded headings' subheadings are hidden; typing
   * searches every heading (fuzzy, like the quick switcher) without re-sorting.
   */
  getSuggestions(query: string): HeadingSuggestion[] {
    const trimmed = query.trim();
    if (!trimmed) return visibleHeadings(this.options.headings, this.folded).map((heading) => ({ heading, match: null }));
    const search = prepareFuzzySearch(trimmed);
    const suggestions: HeadingSuggestion[] = [];
    for (const heading of this.options.headings) {
      const match = search(heading.text);
      if (match) suggestions.push({ heading, match });
    }
    return suggestions;
  }

  renderSuggestion({ heading, match }: HeadingSuggestion, el: HTMLElement): void {
    el.addClass("qes-heading-suggestion");
    // Indented by level in styles.css, so each heading's #s line up with the text of the level above.
    el.createSpan({ cls: "qes-heading-level", text: "#".repeat(heading.level), attr: { "data-level": String(heading.level) } });
    // Long headings are cut off with "…" by CSS; hovering shows the full text.
    const textEl = el.createSpan({ cls: "qes-heading-text", attr: { title: heading.text } });
    renderMatches(textEl, heading.text, match?.matches ?? null);
    if (!match && this.folded.has(heading.line)) {
      const index = this.options.headings.indexOf(heading);
      const hidden = subheadingCount(this.options.headings, index);
      el.createSpan({
        cls: "qes-heading-folded",
        text: `+${hidden}`,
        attr: { title: this.options.strings.hiddenSubheadings.replace("{count}", String(hidden)) }
      });
    }
  }

  onChooseSuggestion({ heading }: HeadingSuggestion): void {
    this.options.onChoose(heading, this.positionSwitch?.get() ?? this.options.position, this.cursorSwitch?.get() ?? this.options.cursorAfterMove);
  }

  /** One bar under the search box: "Prepend [toggle] Append (Alt+A)   Stay [toggle] Follow (Alt+F)". */
  private renderToggles(): void {
    const { options } = this;
    const { strings } = options;
    const bar = createDiv({ cls: "qes-move-position" });
    this.inputEl.parentElement?.insertAdjacentElement("afterend", bar);
    const refocus = (): void => this.inputEl.focus();
    this.positionSwitch = new SideSwitch<InsertPosition>(
      bar, ["prepend", "append"], [strings.prepend, strings.append], options.toggleHotkey,
      options.position, (position) => options.onPositionChange(position), refocus
    );
    this.cursorSwitch = new SideSwitch<CursorAfterMove>(
      bar, ["stay", "follow"], [strings.stay, strings.follow], options.followHotkey,
      options.cursorAfterMove, (cursor) => options.onCursorChange(cursor), refocus
    );
  }

  /** Fallback for keys the scope did not match (e.g. layout differences); same actions. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.handledKeys.has(event)) return;
    const { toggleHotkey, followHotkey, foldHotkeys } = this.options;
    if (toggleHotkey && matchesHotkey(toggleHotkey, event, Platform.isMacOS)) {
      this.handleKey(event, () => this.positionSwitch?.flip());
      return;
    }
    if (followHotkey && matchesHotkey(followHotkey, event, Platform.isMacOS)) {
      this.handleKey(event, () => this.cursorSwitch?.flip());
      return;
    }
    const action = FOLD_ACTIONS.find((candidate) =>
      foldHotkeys[candidate].some((hotkey) => matchesHotkey(hotkey, event, Platform.isMacOS)));
    if (action) this.handleKey(event, () => this.fold(action));
  };

  /** Folding acts on the highlighted heading, and only while the search box is empty. */
  private fold(action: FoldAction): void {
    if (this.inputEl.value.trim()) return;
    const highlighted = this.highlighted();
    if (!highlighted) return;
    const { headings } = this.options;
    let highlight = highlighted.heading.line;
    switch (action) {
      case "foldMore":
        highlight = foldMore(headings, this.folded, highlight);
        break;
      case "foldLess":
        foldLess(headings, this.folded, highlight);
        break;
      case "foldAll":
        highlight = foldAll(headings, this.folded, highlight);
        break;
      case "unfoldAll":
        unfoldAll(this.folded);
        break;
    }
    this.refresh(visibleAncestor(headings, this.folded, highlight));
  }

  // Named getChooser: SuggestModal already has a `chooser` property, which would hide a method of that name.
  private getChooser(): Chooser | undefined {
    // `chooser` is SuggestModal's internal list; not public API, so read it defensively.
    return (this as unknown as { chooser?: Chooser }).chooser;
  }

  private highlighted(): HeadingSuggestion | undefined {
    const chooser = this.getChooser();
    const values = chooser?.values ?? [];
    return values[chooser?.selectedItem ?? 0] ?? values[0];
  }

  /** Re-renders the list and keeps the highlight on the heading at `line`. */
  private refresh(line: number): void {
    this.inputEl.dispatchEvent(new Event("input"));
    const chooser = this.getChooser();
    const index = chooser?.values?.findIndex((value) => value.heading.line === line) ?? -1;
    if (index === -1) return;
    chooser?.setSelectedItem?.(index, null);
    chooser?.suggestions?.[index]?.scrollIntoView({ block: "nearest" });
  }

  /** Tab: fill the input with the highlighted heading, like the quick switcher. */
  private autocomplete(): void {
    const selected = this.highlighted();
    if (!selected) return;
    this.inputEl.value = selected.heading.text;
    this.inputEl.dispatchEvent(new Event("input"));
  }
}

/** Asks before moving part of a line; resolves true to move, false to cancel. */
export function confirmPartialMove(app: App, strings: LocaleStrings["move"]): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.setTitle(strings.partialTitle);
    modal.contentEl.createEl("p", { text: strings.partialMessage });
    const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
    const answer = (value: boolean): void => {
      answered = true;
      resolve(value);
      modal.close();
    };
    const moveButton = buttons.createEl("button", { cls: "mod-cta", text: strings.partialConfirm });
    moveButton.addEventListener("click", () => answer(true));
    buttons.createEl("button", { text: strings.partialCancel }).addEventListener("click", () => answer(false));
    modal.onClose = () => {
      if (!answered) resolve(false);
    };
    modal.open();
    moveButton.focus();
  });
}
