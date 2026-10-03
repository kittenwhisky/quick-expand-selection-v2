import { App, Modal, Platform, SuggestModal, prepareFuzzySearch, renderMatches, type SearchResult } from "obsidian";
import { formatHotkey, matchesHotkey, type ParsedHotkey } from "./hotkey";
import type { InsertPosition } from "./moveToHeading";
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
  strings: LocaleStrings["move"];
  onPositionChange(position: InsertPosition): void;
  onChoose(heading: HeadingLine, position: InsertPosition): void;
}

/** Quick-switcher-style list of the note's headings, with an Append/Prepend toggle. */
export class HeadingSwitcherModal extends SuggestModal<HeadingSuggestion> {
  private position: InsertPosition;
  private readonly toggleButtons = new Map<InsertPosition, HTMLButtonElement>();

  constructor(app: App, private readonly options: HeadingSwitcherOptions) {
    super(app);
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

  override onOpen(): void {
    void super.onOpen();
    this.renderToggle();
    this.modalEl.addEventListener("keydown", this.onKeyDown, true);
  }

  override onClose(): void {
    this.modalEl.removeEventListener("keydown", this.onKeyDown, true);
    super.onClose();
  }

  /** Headings in note order; typing filters them (fuzzy, like the quick switcher) without re-sorting. */
  getSuggestions(query: string): HeadingSuggestion[] {
    const trimmed = query.trim();
    if (!trimmed) return this.options.headings.map((heading) => ({ heading, match: null }));
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
  }

  onChooseSuggestion({ heading }: HeadingSuggestion): void {
    this.options.onChoose(heading, this.position);
  }

  private renderToggle(): void {
    const { strings, toggleHotkey } = this.options;
    const bar = createDiv({ cls: "qes-move-position" });
    this.inputEl.parentElement?.insertAdjacentElement("afterend", bar);
    bar.createSpan({ cls: "qes-move-position-label", text: strings.insert });
    const group = bar.createDiv({ cls: "qes-move-position-toggle" });
    for (const position of ["prepend", "append"] as const) {
      const button = group.createEl("button", { text: position === "append" ? strings.append : strings.prepend });
      button.addEventListener("click", () => {
        this.setPosition(position);
        this.inputEl.focus();
      });
      this.toggleButtons.set(position, button);
    }
    if (toggleHotkey) {
      bar.createSpan({ cls: "qes-move-position-hotkey", text: formatHotkey(toggleHotkey, Platform.isMacOS) });
    }
    this.updateToggle();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const { toggleHotkey } = this.options;
    if (!toggleHotkey || !matchesHotkey(toggleHotkey, event, Platform.isMacOS)) return;
    event.preventDefault();
    event.stopPropagation();
    this.setPosition(this.position === "append" ? "prepend" : "append");
  };

  private setPosition(position: InsertPosition): void {
    if (position === this.position) return;
    this.position = position;
    this.updateToggle();
    this.options.onPositionChange(position);
  }

  private updateToggle(): void {
    for (const [position, button] of this.toggleButtons) {
      const active = position === this.position;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  /** Tab: fill the input with the highlighted heading, like the quick switcher. */
  private autocomplete(): void {
    // `chooser` is SuggestModal's internal list; not public API, so read it defensively.
    const chooser = (this as unknown as { chooser?: { selectedItem?: number; values?: HeadingSuggestion[] | null } }).chooser;
    const values = chooser?.values ?? [];
    const selected = values[chooser?.selectedItem ?? 0] ?? values[0];
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
