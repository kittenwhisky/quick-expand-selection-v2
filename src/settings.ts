import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type QuickExpandSelectionPlugin from "./main";
import { DEFAULT_SENTENCE_MARKERS, getDefaultSelectionRules, type SelectionRules } from "./selection";
import { getLocaleStrings } from "./i18n";

const STRUCTURE_RULES: Array<keyof SelectionRules> = ["list", "heading", "sentence", "code", "latex"];
const EXTRA_STEP_RULES: Array<keyof SelectionRules> = ["whitespace", "punctuation", "pairs", "token", "line"];
const SENTENCE_MARKERS_KEY = "sentenceMarkers";

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
    return [
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
    if (key === SENTENCE_MARKERS_KEY) return this.plugin.settings.sentenceMarkers;
    const rule = this.getRuleKey(key);
    return rule ? this.plugin.settings.rules[rule] : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
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

  private getRuleKey(key: string): keyof SelectionRules | null {
    const prefix = "rules.";
    if (!key.startsWith(prefix)) return null;

    const rule = key.slice(prefix.length) as keyof SelectionRules;
    return Object.prototype.hasOwnProperty.call(getDefaultSelectionRules(), rule) ? rule : null;
  }
}
