import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
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
  verticalLinesAction: LineClickAction;
  wrapCoreCommands: boolean;
}

// Outliner's "zoom-in" action is not offered (it needs the Zoom plugin); a saved one falls back
// to the default.
type LineClickAction = Exclude<VerticalLinesAction, "zoom-in">;
const VERTICAL_LINES_ACTIONS: LineClickAction[] = ["none", "toggle-folding"];

const DEFAULT_SETTINGS: QuickExpandSelectionSettings = {
  version: SETTINGS_VERSION,
  rules: getDefaultSelectionRules(),
  sentenceMarkers: DEFAULT_SENTENCE_MARKERS,
  dragAndDrop: true,
  verticalLines: true,
  verticalLinesAction: "toggle-folding",
  wrapCoreCommands: true
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
      verticalLinesAction: VERTICAL_LINES_ACTIONS.includes(saved?.verticalLinesAction as LineClickAction)
        ? saved?.verticalLinesAction as LineClickAction
        : DEFAULT_SETTINGS.verticalLinesAction,
      wrapCoreCommands: typeof saved?.wrapCoreCommands === "boolean" ? saved.wrapCoreCommands : DEFAULT_SETTINGS.wrapCoreCommands
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

  private shrink(editor: Editor): void {
    const text = this.getText(editor);
    const current = this.getSelectionState(editor, text);
    const history = this.ensureHistory(editor, text, current);
    const next = shrinkSelection(history.selections.slice(0, -1), current);
    if (history.selections.length > 1) history.selections.pop();
    this.setSelection(editor, text, next);
  }
}
