import type { SelectionRules } from "./selection";

export interface LocaleStrings {
  commands: {
    expandSelection: string;
    shrinkSelection: string;
    moveToHeading: string;
  };
  move: {
    placeholder: string;
    noMatch: string;
    navigate: string;
    autocomplete: string;
    move: string;
    dismiss: string;
    append: string;
    prepend: string;
    nothingSelected: string;
    noHeadings: string;
    noteChanged: string;
    partialTitle: string;
    partialMessage: string;
    partialConfirm: string;
    partialCancel: string;
    settingsHeading: string;
    toggleHotkey: string;
    toggleHotkeyDescription: string;
    toggleHotkeyInvalid: string;
    cursorAfterMove: string;
    cursorAfterMoveDescription: string;
    cursorOptions: Record<"stay" | "follow", string>;
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
  coreCommands: {
    heading: string;
    wrap: string;
    wrapDescription: string;
    listName: string;
  };
  lists: {
    heading: string;
    dragAndDrop: string;
    dragAndDropDescription: string;
    verticalLines: string;
    verticalLinesDescription: string;
    verticalLinesAction: string;
    verticalLinesActionDescription: string;
    verticalLinesActions: Record<"none" | "toggle-folding", string>;
  };
  notices: {
    expansionHistoryReset: string;
  };
}

const en: LocaleStrings = {
  commands: {
    expandSelection: "Expand selection",
    shrinkSelection: "Shrink selection",
    moveToHeading: "Move selection to note heading"
  },
  move: {
    placeholder: "Move selection to note heading…",
    noMatch: "No matching heading.",
    navigate: "to navigate",
    autocomplete: "to autocomplete",
    move: "to move",
    dismiss: "to dismiss",
    append: "Append",
    prepend: "Prepend",
    nothingSelected: "Select the text to move first.",
    noHeadings: "This note has no headings to move the selection under.",
    noteChanged: "The note changed while choosing a heading, so nothing was moved.",
    partialTitle: "Move part of a line?",
    partialMessage: "The selection covers only part of a line. Only the selected text will move, onto its own line under the heading; the rest of the line stays where it is.",
    partialConfirm: "Move",
    partialCancel: "Cancel",
    settingsHeading: "Move selection to note heading",
    toggleHotkey: "Append/Prepend toggle hotkey",
    toggleHotkeyDescription: "Switches between Append and Prepend while the heading list is open, e.g. Alt+A or Mod+Shift+P (Mod is Ctrl, or Cmd on macOS). The list remembers your last choice.",
    toggleHotkeyInvalid: "Use modifiers plus one key, e.g. Alt+A.",
    cursorAfterMove: "Cursor after moving",
    cursorAfterMoveDescription: "Where the cursor goes once the text has moved.",
    cursorOptions: { stay: "Stay where it was", follow: "Follow the moved text" }
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
  coreCommands: {
    heading: "Core commands",
    wrap: "Wrap useful core commands",
    wrapDescription: "Add a command for each core command below that simply runs it, so they all appear together when you filter the command palette by this plugin's name. The core commands and their hotkeys are unchanged.",
    listName: "Wrapped core commands"
  },
  lists: {
    heading: "Lists",
    dragAndDrop: "Drag-and-drop",
    dragAndDropDescription: "Drag a bullet (or its checkbox or fold arrow) to move the item and its children. Press Escape to cancel. Desktop only.",
    verticalLines: "Draw vertical indentation lines",
    verticalLinesDescription: "Draw a line from each bullet down past its children.",
    verticalLinesAction: "Vertical indentation line click action",
    verticalLinesActionDescription: "What clicking a vertical line does.",
    verticalLinesActions: { none: "None", "toggle-folding": "Toggle folding" }
  },
  notices: {
    expansionHistoryReset: "Expansion history reset."
  }
};

const zhCn: LocaleStrings = {
  commands: {
    expandSelection: "扩选文本",
    shrinkSelection: "缩选文本",
    moveToHeading: "将所选内容移动到笔记标题下"
  },
  move: {
    placeholder: "将所选内容移动到笔记标题下…",
    noMatch: "没有匹配的标题。",
    navigate: "导航",
    autocomplete: "自动补全",
    move: "移动",
    dismiss: "关闭",
    append: "追加",
    prepend: "前置",
    nothingSelected: "请先选择要移动的文本。",
    noHeadings: "此笔记中没有可移动到的标题。",
    noteChanged: "选择标题期间笔记已更改，未移动任何内容。",
    partialTitle: "移动行的一部分？",
    partialMessage: "所选内容只覆盖了一行的一部分。只有所选文本会移动，并单独成行放在标题下；该行的其余部分保持不变。",
    partialConfirm: "移动",
    partialCancel: "取消",
    settingsHeading: "将所选内容移动到笔记标题下",
    toggleHotkey: "追加/前置切换快捷键",
    toggleHotkeyDescription: "在标题列表打开时切换追加和前置，例如 Alt+A 或 Mod+Shift+P（Mod 为 Ctrl，macOS 上为 Cmd）。列表会记住你上次的选择。",
    toggleHotkeyInvalid: "请使用修饰键加一个按键，例如 Alt+A。",
    cursorAfterMove: "移动后的光标位置",
    cursorAfterMoveDescription: "文本移动后光标所在的位置。",
    cursorOptions: { stay: "保持原位", follow: "跟随移动的文本" }
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
  coreCommands: {
    heading: "核心命令",
    wrap: "包装常用核心命令",
    wrapDescription: "为下列每个核心命令添加一个直接运行它的命令，这样在命令面板中按本插件名称筛选时它们会一起出现。核心命令及其快捷键保持不变。",
    listName: "已包装的核心命令"
  },
  lists: {
    heading: "列表",
    dragAndDrop: "拖放",
    dragAndDropDescription: "拖动项目符号（或复选框、折叠箭头）以移动该项及其子项。按 Esc 取消。仅限桌面端。",
    verticalLines: "绘制垂直缩进线",
    verticalLinesDescription: "从每个项目符号向下绘制一条贯穿其子项的线。",
    verticalLinesAction: "垂直缩进线点击操作",
    verticalLinesActionDescription: "点击垂直线时执行的操作。",
    verticalLinesActions: { none: "无", "toggle-folding": "切换折叠" }
  },
  notices: {
    expansionHistoryReset: "已重置扩选历史"
  }
};

export function getLocaleStringsForLanguage(rawLanguage: string): LocaleStrings {
  const language = rawLanguage.toLowerCase().replace(/_/g, "-");
  return language === "zh" ? zhCn : en;
}
