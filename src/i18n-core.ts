import type { SelectionRules } from "./selection";

export interface LocaleStrings {
  commands: {
    expandSelection: string;
    shrinkSelection: string;
  };
  rules: Record<keyof SelectionRules, { name: string; description: string }>;
  settings: {
    heading: string;
    descriptionName: string;
    description: string;
    sentenceMarkers: string;
    sentenceMarkersDescription: string;
    extraStepsHeading: string;
    extraStepsDescription: string;
    aliases: string[];
    resetHistory: string;
    resetHistoryDescription: string;
    resetButton: string;
  };
  notices: {
    expansionHistoryReset: string;
  };
}

const en: LocaleStrings = {
  commands: {
    expandSelection: "Expand selection",
    shrinkSelection: "Shrink selection"
  },
  rules: {
    list: { name: "List hierarchy", description: "In a list, expand through the bullet line, the bullet with its children, each parent bullet with its children, then the whole list." },
    heading: { name: "Heading hierarchy", description: "Expand to the heading line, its section (up to the next heading of the same or higher level), then each parent section. Lists and paragraphs continue into these steps." },
    sentence: { name: "Sentences", description: "In a paragraph, expand to the current sentence before the whole paragraph." },
    code: { name: "Code blocks", description: "Use IDE-style expansion inside fenced code blocks, then the whole code block." },
    latex: { name: "LaTeX", description: "Recognize inline math, \\(...\\), \\[...\\], and $...$." },
    whitespace: { name: "Whitespace", description: "Add a step that extends the selection over neighbouring spaces and tabs." },
    punctuation: { name: "Punctuation and symbols", description: "Add a step that extends the selection over neighbouring punctuation and symbols." },
    pairs: { name: "Brackets and Markdown markers", description: "Add steps for enclosing brackets and **bold**, _italic_, `code` and ~~strikethrough~~ markers." },
    token: { name: "Token", description: "Add a step for the run of non-space characters around the selection." },
    line: { name: "Line within paragraph", description: "Add a step for the current line before the whole paragraph." }
  },
  settings: {
    heading: "Expansion rules",
    descriptionName: "About",
    description: "Expand and shrink selection commands appear in Obsidian's Hotkeys settings (defaults: Ctrl/Cmd+A and Ctrl/Cmd+Shift+A). Each press selects the next larger unit: list, paragraph and code steps lead into the heading steps, then the whole note.",
    sentenceMarkers: "Sentence end markers",
    sentenceMarkersDescription: "Characters that end a sentence. Half-width markers need a following space or line end; full-width markers such as 。 do not.",
    extraStepsHeading: "Extra steps",
    extraStepsDescription: "Optional finer steps between the word and the structural levels. Off by default.",
    aliases: ["Expansion rules", "Selection range"],
    resetHistory: "Reset expansion history",
    resetHistoryDescription: "Clear the expansion history for the current editor.",
    resetButton: "Reset"
  },
  notices: {
    expansionHistoryReset: "Expansion history reset."
  }
};

const zhCn: LocaleStrings = {
  commands: {
    expandSelection: "扩选文本",
    shrinkSelection: "缩选文本"
  },
  rules: {
    list: { name: "列表层级", description: "在列表中依次扩选当前行、当前项及其子项、各级父项及其子项，最后是整个列表。" },
    heading: { name: "标题层级", description: "依次扩选标题行、该标题的内容区域（直到下一个同级或更高级标题）、各级父标题区域。列表和段落会接续到这些层级。" },
    sentence: { name: "句子", description: "在段落中先扩选当前句子，再扩选整个段落。" },
    code: { name: "代码段", description: "在 fenced code block 内按 IDE 风格扩选，并支持整个代码段。" },
    latex: { name: "LaTeX", description: "识别行级数学环境、\\(...\\)、\\[...\\] 和 $...$。" },
    whitespace: { name: "空白字符", description: "增加一步：扩选到相邻的空格和制表符。" },
    punctuation: { name: "标点和符号", description: "增加一步：扩选到相邻的标点和符号。" },
    pairs: { name: "括号和 Markdown 标记", description: "增加括号以及 **粗体**、_斜体_、`代码`、~~删除线~~ 标记的扩选层级。" },
    token: { name: "连续字符", description: "增加一步：扩选到选区周围的连续非空白字符。" },
    line: { name: "段落内的行", description: "在扩选整个段落前先扩选当前行。" }
  },
  settings: {
    heading: "扩选规则",
    descriptionName: "说明",
    description: "扩选和缩选命令会出现在 Obsidian 的快捷键设置中（默认：Ctrl/Cmd+A 和 Ctrl/Cmd+Shift+A）。每次按键扩选到下一个更大的单元：列表、段落和代码会接续到标题层级，最后是整篇笔记。",
    sentenceMarkers: "句末标记",
    sentenceMarkersDescription: "表示句子结束的字符。半角标记后需要空格或行尾；全角标记（如 。）不需要。",
    extraStepsHeading: "额外层级",
    extraStepsDescription: "在单词和结构层级之间的可选细分层级，默认关闭。",
    aliases: ["扩选规则", "选择范围"],
    resetHistory: "重置扩选历史",
    resetHistoryDescription: "清除当前编辑器中的扩选层级记录。",
    resetButton: "重置"
  },
  notices: {
    expansionHistoryReset: "已重置扩选历史"
  }
};

export function getLocaleStringsForLanguage(rawLanguage: string): LocaleStrings {
  const language = rawLanguage.toLowerCase().replace(/_/g, "-");
  return language === "zh" ? zhCn : en;
}
