import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type QuickExpandSelectionPlugin from "./main";
import { DEFAULT_SENTENCE_MARKERS, getDefaultSelectionRules, type SelectionRules } from "./selection";
import { getLocaleStrings } from "./i18n";
import { WRAPPED_CORE_COMMANDS, coreCommandName } from "./coreCommands";
import { parseHotkey } from "./hotkey";
import { DEFAULT_INSERT_TOGGLE_HOTKEY, type CursorAfterMove } from "./moveToHeading";

const STRUCTURE_RULES: Array<keyof SelectionRules> = ["list", "heading", "sentence", "code", "latex"];
const EXTRA_STEP_RULES: Array<keyof SelectionRules> = ["whitespace", "punctuation", "pairs", "token", "line"];
const SENTENCE_MARKERS_KEY = "sentenceMarkers";
const LIST_KEYS = ["dragAndDrop", "verticalLines", "verticalLinesAction"] as const;
type ListKey = (typeof LIST_KEYS)[number];

export class QuickExpandSelectionSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: QuickExpandSelectionPlugin) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const strings = getLocaleStrings();
    const defaults = getDefaultSelectionRules();
    const toggle = (key: keyof SelectionRules) => ({
      name: strings.rules[key].name,
      desc: strings.rules[key].description,
      aliases: strings.settings.aliases,
      control: {
        type: "toggle" as const,
        key: `rules.${key}`,
        defaultValue: defaults[key]
      }
    });
    const list = strings.lists;
    const core = strings.coreCommands;
    const move = strings.move;
    return [
      {
        type: "group",
        heading: move.settingsHeading,
        items: [
          {
            name: move.toggleHotkey,
            desc: move.toggleHotkeyDescription,
            control: {
              type: "text" as const,
              key: "insertToggleHotkey",
              defaultValue: DEFAULT_INSERT_TOGGLE_HOTKEY,
              placeholder: DEFAULT_INSERT_TOGGLE_HOTKEY,
              validate: (value: string) => (parseHotkey(value) ? undefined : move.toggleHotkeyInvalid)
            }
          },
          {
            name: move.cursorAfterMove,
            desc: move.cursorAfterMoveDescription,
            control: { type: "dropdown" as const, key: "cursorAfterMove", defaultValue: "stay", options: move.cursorOptions }
          }
        ]
      },
      {
        type: "group",
        heading: core.heading,
        items: [
          {
            name: core.wrap,
            desc: core.wrapDescription,
            control: { type: "toggle" as const, key: "wrapCoreCommands", defaultValue: true }
          },
          {
            name: core.listName,
            desc: this.wrappedCommandList()
          }
        ]
      },
      {
        type: "group",
        heading: list.heading,
        items: [
          {
            name: list.dragAndDrop,
            desc: list.dragAndDropDescription,
            control: { type: "toggle" as const, key: "dragAndDrop", defaultValue: true }
          },
          {
            name: list.verticalLines,
            desc: list.verticalLinesDescription,
            control: { type: "toggle" as const, key: "verticalLines", defaultValue: true }
          },
          {
            name: list.verticalLinesAction,
            desc: list.verticalLinesActionDescription,
            control: {
              type: "dropdown" as const,
              key: "verticalLinesAction",
              defaultValue: "toggle-folding",
              options: list.verticalLinesActions
            }
          }
        ]
      },
      {
        type: "group",
        heading: strings.settings.heading,
        items: [
          {
            name: strings.settings.descriptionName,
            desc: strings.settings.description
          },
          ...STRUCTURE_RULES.map(toggle),
          {
            name: strings.settings.sentenceMarkers,
            desc: strings.settings.sentenceMarkersDescription,
            control: {
              type: "text" as const,
              key: SENTENCE_MARKERS_KEY,
              defaultValue: DEFAULT_SENTENCE_MARKERS,
              placeholder: DEFAULT_SENTENCE_MARKERS
            }
          }
        ]
      },
      {
        type: "group",
        heading: strings.settings.extraStepsHeading,
        items: [
          {
            name: strings.settings.descriptionName,
            desc: strings.settings.extraStepsDescription
          },
          ...EXTRA_STEP_RULES.map(toggle),
          {
            name: strings.settings.resetHistory,
            desc: strings.settings.resetHistoryDescription,
            action: () => this.plugin.clearSelectionHistory()
          }
        ]
      }
    ];
  }

  override getControlValue(key: string): unknown {
    if (key === "wrapCoreCommands") return this.plugin.settings.wrapCoreCommands;
    if (key === "insertToggleHotkey") return this.plugin.settings.insertToggleHotkey;
    if (key === "cursorAfterMove") return this.plugin.settings.cursorAfterMove;
    if (this.isListKey(key)) return this.plugin.settings[key];
    if (key === SENTENCE_MARKERS_KEY) return this.plugin.settings.sentenceMarkers;
    const rule = this.getRuleKey(key);
    return rule ? this.plugin.settings.rules[rule] : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "insertToggleHotkey") {
      if (typeof value !== "string" || !parseHotkey(value)) return;
      this.plugin.settings.insertToggleHotkey = value;
      await this.plugin.saveSettings();
      return;
    }
    if (key === "cursorAfterMove") {
      if (value !== "stay" && value !== "follow") return;
      this.plugin.settings.cursorAfterMove = value;
      await this.plugin.saveSettings();
      return;
    }
    if (key === "verticalLinesAction") {
      if (typeof value !== "string" || !(value in getLocaleStrings().lists.verticalLinesActions)) return;
      this.plugin.settings.verticalLinesAction = value as QuickExpandSelectionPlugin["settings"]["verticalLinesAction"];
      await this.plugin.saveSettings();
      return;
    }
    if (key === "dragAndDrop" || key === "verticalLines" || key === "wrapCoreCommands") {
      if (typeof value !== "boolean") return;
      this.plugin.settings[key] = value;
      await this.plugin.saveSettings();
      return;
    }
    if (key === SENTENCE_MARKERS_KEY) {
      if (typeof value !== "string") return;
      this.plugin.settings.sentenceMarkers = value;
      await this.plugin.saveSettings();
      return;
    }
    const rule = this.getRuleKey(key);
    if (!rule || typeof value !== "boolean") return;
    this.plugin.settings.rules[rule] = value;
    await this.plugin.saveSettings();
  }

  // Fallback for Obsidian versions before getSettingDefinitions (1.13).
  override display(): void {
    const strings = getLocaleStrings();
    const { containerEl } = this;
    containerEl.empty();
    const list = strings.lists;
    const core = strings.coreCommands;
    const move = strings.move;

    new Setting(containerEl).setName(move.settingsHeading).setHeading();
    new Setting(containerEl)
      .setName(move.toggleHotkey)
      .setDesc(move.toggleHotkeyDescription)
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_INSERT_TOGGLE_HOTKEY)
          .setValue(this.plugin.settings.insertToggleHotkey)
          .onChange(async (value) => {
            if (!parseHotkey(value)) return;
            this.plugin.settings.insertToggleHotkey = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName(move.cursorAfterMove)
      .setDesc(move.cursorAfterMoveDescription)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(move.cursorOptions)
          .setValue(this.plugin.settings.cursorAfterMove)
          .onChange(async (value) => {
            this.plugin.settings.cursorAfterMove = value as CursorAfterMove;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName(core.heading).setHeading();
    new Setting(containerEl)
      .setName(core.wrap)
      .setDesc(core.wrapDescription)
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.wrapCoreCommands).onChange(async (value) => {
          this.plugin.settings.wrapCoreCommands = value;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl).setName(core.listName).setDesc(this.wrappedCommandList());

    new Setting(containerEl).setName(list.heading).setHeading();
    for (const key of ["dragAndDrop", "verticalLines"] as const) {
      new Setting(containerEl)
        .setName(list[key])
        .setDesc(list[`${key}Description`])
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          });
        });
    }
    new Setting(containerEl)
      .setName(list.verticalLinesAction)
      .setDesc(list.verticalLinesActionDescription)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(list.verticalLinesActions)
          .setValue(this.plugin.settings.verticalLinesAction)
          .onChange(async (value) => {
            this.plugin.settings.verticalLinesAction = value as QuickExpandSelectionPlugin["settings"]["verticalLinesAction"];
            await this.plugin.saveSettings();
          });
      });

    const addToggle = (key: keyof SelectionRules): void => {
      const description = strings.rules[key];
      new Setting(containerEl)
        .setName(description.name)
        .setDesc(description.description)
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.rules[key])
            .onChange(async (value) => {
              this.plugin.settings.rules[key] = value;
              await this.plugin.saveSettings();
            });
        });
    };

    new Setting(containerEl).setName(strings.settings.heading).setHeading();
    containerEl.createEl("p", { text: strings.settings.description, cls: "setting-item-description" });
    STRUCTURE_RULES.forEach(addToggle);
    new Setting(containerEl)
      .setName(strings.settings.sentenceMarkers)
      .setDesc(strings.settings.sentenceMarkersDescription)
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SENTENCE_MARKERS)
          .setValue(this.plugin.settings.sentenceMarkers)
          .onChange(async (value) => {
            this.plugin.settings.sentenceMarkers = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName(strings.settings.extraStepsHeading).setHeading();
    containerEl.createEl("p", { text: strings.settings.extraStepsDescription, cls: "setting-item-description" });
    EXTRA_STEP_RULES.forEach(addToggle);

    new Setting(containerEl)
      .setName(strings.settings.resetHistory)
      .setDesc(strings.settings.resetHistoryDescription)
      .addButton((button) => {
        button.setButtonText(strings.settings.resetButton).onClick(() => {
          this.plugin.clearSelectionHistory();
        });
      });
  }

  /** The wrapped commands, one per line, by their core names. */
  private wrappedCommandList(): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const items = fragment.createEl("ul");
    for (const { id, fallbackName } of WRAPPED_CORE_COMMANDS) {
      items.createEl("li", { text: coreCommandName(this.app, id, fallbackName) });
    }
    return fragment;
  }

  private isListKey(key: string): key is ListKey {
    return (LIST_KEYS as readonly string[]).includes(key);
  }

  private getRuleKey(key: string): keyof SelectionRules | null {
    const prefix = "rules.";
    if (!key.startsWith(prefix)) return null;

    const rule = key.slice(prefix.length) as keyof SelectionRules;
    return Object.prototype.hasOwnProperty.call(getDefaultSelectionRules(), rule) ? rule : null;
  }
}
