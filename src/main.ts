import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { Editor, MarkdownView, Notice, Plugin, editorInfoField } from "obsidian";
import { parseHotkey } from "./hotkey";
import {
  DEFAULT_INSERT_TOGGLE_HOTKEY,
  isWholeLineSelection,
  movableTargets,
  planMove,
  type CursorAfterMove,
  type InsertPosition
} from "./moveToHeading";
import { HeadingSwitcherModal, confirmPartialMove } from "./moveToHeadingModal";
import {
  DEFAULT_SENTENCE_MARKERS,
  expandSelection,
  getDefaultSelectionRules,
  getSelectionRange,
  offsetToPosition,
  positionToOffset,
  shrinkSelection,
  type SelectionRules,
  type SelectionState
} from "./selection";
import { QuickExpandSelectionSettingTab } from "./settings";
import { getLocaleStrings } from "./i18n";
import { registerCoreCommandWrappers, removeCoreCommandWrappers } from "./coreCommands";
import { ChangesApplicator } from "./outliner/ChangesApplicator";
import { DragAndDrop } from "./outliner/DragAndDrop";
import type { Feature } from "./outliner/Feature";
import { ObsidianSettings } from "./outliner/ObsidianSettings";
import { OperationPerformer } from "./outliner/OperationPerformer";
import { Parser } from "./outliner/Parser";
import type { Settings as OutlinerSettings, VerticalLinesAction } from "./outliner/Settings";
import { VerticalLines } from "./outliner/VerticalLines";

const SETTINGS_VERSION = 2;

export interface QuickExpandSelectionSettings {
  version: number;
  rules: SelectionRules;
  sentenceMarkers: string;
  dragAndDrop: boolean;
  verticalLines: boolean;
  verticalLinesAction: VerticalLinesAction;
  wrapCoreCommands: boolean;
  /** The heading switcher's Append/Prepend toggle, remembered between uses. */
  insertPosition: InsertPosition;
  insertToggleHotkey: string;
  cursorAfterMove: CursorAfterMove;
}


// A value no longer offered (Outliner's "zoom-in") falls back to the default when loaded.
const VERTICAL_LINES_ACTIONS: VerticalLinesAction[] = ["none", "toggle-folding"];

const DEFAULT_SETTINGS: QuickExpandSelectionSettings = {
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
const V1_ONLY_RULES = ["whitespace", "punctuation", "line"] as const;

interface EditorHistory {
  text: string;
  selections: SelectionState[];
}

export default class QuickExpandSelectionPlugin extends Plugin {
  override settings: QuickExpandSelectionSettings = DEFAULT_SETTINGS;
  private readonly historyByEditor = new WeakMap<Editor, EditorHistory>();
  private readonly settingsCallbacks = new Set<() => void>();
  private features: Feature[] = [];
  private coreCommandsWrapped = false;

  /** The view of these settings that the features adapted from Outliner read. */
  readonly outlinerSettings: OutlinerSettings = ((plugin: QuickExpandSelectionPlugin): OutlinerSettings => ({
    get dragAndDrop() { return plugin.settings.dragAndDrop; },
    get verticalLines() { return plugin.settings.verticalLines; },
    get verticalLinesAction() { return plugin.settings.verticalLinesAction; },
    onChange: (callback) => { plugin.settingsCallbacks.add(callback); },
    removeCallback: (callback) => { plugin.settingsCallbacks.delete(callback); }
  }))(this);

  override async onload(): Promise<void> {
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

    // Escape right after expanding returns the cursor to where it was before the first expand.
    this.registerEditorExtension(Prec.high(keymap.of([{
      key: "Escape",
      run: (view) => {
        const editor = view.state.field(editorInfoField, false)?.editor;
        return editor ? this.returnToOrigin(editor) : false;
      }
    }])));

    this.addCommand({
      id: "move-selection-to-note-heading",
      name: strings.commands.moveToHeading,
      icon: "heading",
      editorCallback: (editor) => void this.moveSelectionToHeading(editor)
    });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      if (!editor.somethingSelected()) return;
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
    for (const feature of this.features) await feature.load();
  }

  override async onunload(): Promise<void> {
    // WeakMap history is released with its editor instances.
    for (const feature of this.features) await feature.unload();
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<QuickExpandSelectionSettings> | null;
    const savedRules: Partial<SelectionRules> = { ...(saved?.rules ?? {}) };
    if ((saved?.version ?? 1) < SETTINGS_VERSION) {
      for (const rule of V1_ONLY_RULES) delete savedRules[rule];
    }
    const rules = getDefaultSelectionRules();
    for (const key of Object.keys(rules) as Array<keyof SelectionRules>) {
      if (typeof savedRules[key] === "boolean") rules[key] = savedRules[key];
    }
    this.settings = {
      version: SETTINGS_VERSION,
      rules,
      sentenceMarkers: typeof saved?.sentenceMarkers === "string" ? saved.sentenceMarkers : DEFAULT_SENTENCE_MARKERS,
      dragAndDrop: typeof saved?.dragAndDrop === "boolean" ? saved.dragAndDrop : DEFAULT_SETTINGS.dragAndDrop,
      verticalLines: typeof saved?.verticalLines === "boolean" ? saved.verticalLines : DEFAULT_SETTINGS.verticalLines,
      verticalLinesAction: VERTICAL_LINES_ACTIONS.includes(saved?.verticalLinesAction as VerticalLinesAction)
        ? saved?.verticalLinesAction as VerticalLinesAction
        : DEFAULT_SETTINGS.verticalLinesAction,
      wrapCoreCommands: typeof saved?.wrapCoreCommands === "boolean" ? saved.wrapCoreCommands : DEFAULT_SETTINGS.wrapCoreCommands,
      insertPosition: saved?.insertPosition === "prepend" ? "prepend" : "append",
      insertToggleHotkey: typeof saved?.insertToggleHotkey === "string" && parseHotkey(saved.insertToggleHotkey)
        ? saved.insertToggleHotkey
        : DEFAULT_INSERT_TOGGLE_HOTKEY,
      cursorAfterMove: saved?.cursorAfterMove === "follow" ? "follow" : "stay"
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyCoreCommandWrappers();
    for (const callback of this.settingsCallbacks) callback();
  }

  private applyCoreCommandWrappers(): void {
    if (this.settings.wrapCoreCommands === this.coreCommandsWrapped) return;
    if (this.settings.wrapCoreCommands) registerCoreCommandWrappers(this);
    else removeCoreCommandWrappers(this);
    this.coreCommandsWrapped = this.settings.wrapCoreCommands;
  }

  private async moveSelectionToHeading(editor: Editor): Promise<void> {
    const strings = getLocaleStrings().move;
    const text = editor.getValue();
    const range = getSelectionRange(this.getSelectionState(editor, text));
    if (range.from === range.to) {
      new Notice(strings.nothingSelected);
      return;
    }
    const headings = movableTargets(text, range);
    if (headings.length === 0) {
      new Notice(strings.noHeadings);
      return;
    }
    if (!isWholeLineSelection(text, range) && !(await confirmPartialMove(this.app, strings))) return;

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
          new Notice(strings.noteChanged);
          return;
        }
        const plan = planMove(text, range, heading.line, position);
        if (!plan) return;
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
        } else {
          editor.setCursor(editor.offsetToPos(plan.removedAt));
        }
      }
    }).open();
  }

  clearSelectionHistory(): void {
    const editor = this.getActiveEditor();
    if (editor) this.historyByEditor.delete(editor);
    new Notice(getLocaleStrings().notices.expansionHistoryReset);
  }

  private getActiveEditor(): Editor | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.editor ?? null;
  }

  private getText(editor: Editor): string {
    return editor.getValue();
  }

  private getSelectionState(editor: Editor, text: string): SelectionState {
    return {
      anchor: positionToOffset(text, editor.getCursor("anchor")),
      head: positionToOffset(text, editor.getCursor("head"))
    };
  }

  private setSelection(editor: Editor, text: string, selection: SelectionState): void {
    editor.setSelection(offsetToPosition(text, selection.anchor), offsetToPosition(text, selection.head));
  }

  private ensureHistory(editor: Editor, text: string, current: SelectionState): EditorHistory {
    const existing = this.historyByEditor.get(editor);
    const range = getSelectionRange(current);
    const existingCurrent = existing?.selections.at(-1);
    if (!existing || existing.text !== text || !existingCurrent || getSelectionRange(existingCurrent).from !== range.from || getSelectionRange(existingCurrent).to !== range.to) {
      const history: EditorHistory = { text, selections: [current] };
      this.historyByEditor.set(editor, history);
      return history;
    }
    return existing;
  }

  private expand(editor: Editor): void {
    const text = this.getText(editor);
    const current = this.getSelectionState(editor, text);
    const history = this.ensureHistory(editor, text, current);
    const nextRange = expandSelection(text, current, this.settings.rules, this.settings.sentenceMarkers);
    const next: SelectionState = current.anchor <= current.head
      ? { anchor: nextRange.from, head: nextRange.to }
      : { anchor: nextRange.to, head: nextRange.from };
    const previous = history.selections.at(-1);
    if (!previous || previous.anchor !== next.anchor || previous.head !== next.head) {
      history.selections.push(next);
    }
    this.setSelection(editor, text, next);
  }

  /**
   * Restores the selection from before the first expand, if the current selection is still the
   * last one this plugin made and the note is unchanged. Returns false (leaving Escape to do its
   * usual job) otherwise.
   */
  private returnToOrigin(editor: Editor): boolean {
    const history = this.historyByEditor.get(editor);
    if (!history || history.selections.length < 2) return false;
    const text = this.getText(editor);
    if (history.text !== text) return false;
    const current = getSelectionRange(this.getSelectionState(editor, text));
    const last = getSelectionRange(history.selections[history.selections.length - 1]);
    if (current.from !== last.from || current.to !== last.to) return false;
    this.historyByEditor.delete(editor);
    this.setSelection(editor, text, history.selections[0]);
    return true;
  }

  private shrink(editor: Editor): void {
    const text = this.getText(editor);
    const current = this.getSelectionState(editor, text);
    const history = this.ensureHistory(editor, text, current);
    const next = shrinkSelection(history.selections.slice(0, -1), current);
    if (history.selections.length > 1) history.selections.pop();
    this.setSelection(editor, text, next);
  }
}
