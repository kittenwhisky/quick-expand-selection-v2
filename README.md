# Quick Expand Selection V2

An Obsidian plugin for working with the structure of a note from the keyboard and mouse:

- **Expand and shrink the selection** one structural step at a time: word, sentence, paragraph, bullet, bullet with its children, whole list, heading section, parent sections, whole note.
- **Move selection to note heading:** pick a heading in the current note from a quick-switcher-style list and the selected text moves under it.
- **Drag and drop list items** by their bullets, moving each item with its children.
- **Vertical indentation lines** beside nested bullets. Click a line to fold or unfold that branch.
- **Related core commands in one place.** Move line, indent/unindent and fold commands get V2 entries, so filtering the command palette by "Quick Expand Selection V2" shows everything together.

V2 is a fork of [Quick Expand Selection](https://github.com/mushan-bit/quick-expand-selection) by MuShan-bit. The drag-and-drop and indentation-line features are adapted from [Outliner](https://github.com/vslinko/obsidian-outliner) by Viacheslav Slinko. Both are MIT-licensed; see [Credits and licences](#credits-and-licences).

## Contents

- [Installation](#installation)
- [Expand and shrink selection](#expand-and-shrink-selection)
  - [Hotkeys](#hotkeys)
  - [Expansion order](#expansion-order)
  - [What counts as what](#what-counts-as-what)
  - [Shrinking](#shrinking)
  - [Worked example](#worked-example)
- [Move selection to note heading](#move-selection-to-note-heading)
- [Lists: drag and drop and indentation lines](#lists-drag-and-drop-and-indentation-lines)
- [Core commands](#core-commands)
- [Settings reference](#settings-reference)
- [Differences from the original plugins](#differences-from-the-original-plugins)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Credits and licences](#credits-and-licences)

## Installation

V2 is not in the community plugin directory. To install it manually:

1. Create `<vault>/.obsidian/plugins/quick-expand-selection-v2/`.
2. Copy `main.js`, `manifest.json` and `styles.css` from this repository into it.
3. Reload Obsidian and enable **Quick Expand Selection V2** under **Settings → Community plugins**.

If the original Quick Expand Selection or Outliner is also enabled, see [Known limitations](#known-limitations).

## Expand and shrink selection

### Hotkeys

| Command | Default hotkey |
|---|---|
| Expand selection | **Ctrl+A** (Windows/Linux), **Cmd+A** (macOS) |
| Shrink selection | **Ctrl+Shift+A**, **Cmd+Shift+A** |

Change them under **Settings → Hotkeys**. Both commands repeat while the key is held.

Taking over Ctrl/Cmd+A is safe: keep pressing it and the last step is always the whole note.

### Expansion order

Each press selects the smallest unit that is larger than the current selection. The steps depend on where the selection starts:

| Selection starts in | Steps |
|---|---|
| **A bullet** | word → bullet line → bullet with its children → parent bullet with its children → … → whole list → *heading steps* |
| **A paragraph** | word → sentence → paragraph → *heading steps* |
| **A heading line** | word → heading line → *heading steps* |
| **A code block** | word → enclosing brackets or quotes → code line → whole code block → *the bullet steps (if the block is inside a list item), otherwise the heading steps* |
| **LaTeX** | enclosing brackets → the maths → *the steps of the surrounding bullet or paragraph* |

The **heading steps** are: the section of the nearest heading above → each parent section → the whole note. Text with no heading above it goes straight to the whole note.

A **heading section** runs from the heading line to just before the next heading of the same or higher level, so subheadings stay inside their parent's section.

Steps that would not change the selection are skipped, for example "bullet with its children" on a bullet that has none.

### What counts as what

- **Bullet:** a line starting with `-`, `*`, `+`, `1.` or `1)`, with or without a checkbox. The bullet line step selects the whole line, including the marker and indentation.
- **Children:** every following line indented deeper than the bullet. That covers nested bullets, indented continuation text and indented code blocks.
- **Whole list:** the top-level bullets and everything nested under them. A list continues across blank lines as long as the next non-blank line still belongs to it. A heading, or text that is not indented under a bullet, ends it.
- **Paragraph:** consecutive non-blank lines, ending at a blank line, a heading, a bullet or the edge of a code block.
- **Sentence:** ends after a run of sentence end markers (default `.!?。！？`), plus any closing quotes or brackets. A half-width marker such as `.` must be followed by a space or the end of the paragraph, so `3.5` and `example.com` do not split a sentence. A full-width marker such as `。` needs no space. Abbreviations such as "e.g. " do split a sentence.
- **Headings inside code blocks** (for example `# comment` in a shell script) are ignored.

### Shrinking

**Shrink selection** steps back through the selections you expanded through, in reverse. Shrinking all the way puts the cursor back where it was before the first expand.

**Escape** jumps straight back: right after expanding (or shrinking part of the way), Escape restores the cursor, or the selection, from before the first expand. Escape only does this while the selection is still the one the plugin made; otherwise it behaves as usual.

The history is kept per editor. Typing, or changing the selection yourself, clears it, and the next shrink just collapses the selection. **Reset expansion history** in the settings clears it by hand.

### Worked example

```markdown
# Project

## Tasks
Plan the week. Then review it!

- Write report
  - Draft
    - Outline
  - Edit
- Send report

## Notes
```

With the cursor in `Outline`, repeated presses select:

1. `Outline`
2. `    - Outline`
3. `  - Draft` and `    - Outline`
4. `- Write report` and everything nested under it
5. the whole list (`- Write report` … `- Send report`)
6. the `## Tasks` section, up to just before `## Notes`
7. the `# Project` section, which here is the whole note

With the cursor in `review`: `review` → `Then review it!` → the paragraph → the `## Tasks` section → the whole note.

## Move selection to note heading

Moves the selected text under a heading **in the same note**.

Run it from the command palette, or right-click selected text and choose **Move selection to note heading**. It has no default hotkey; assign one under **Settings → Hotkeys**.

### The heading list

A window like the quick switcher lists every heading in the note, in the order they appear. Each heading shows its level as `#`, `##`, `###` and so on, in grey to its left, and is indented by level so its `#`s start where the text of the level above starts:

```
# Project
  ## Tasks
     ### Today
  ## Notes
```

Indentation goes by level number, so an H3 sits in the H3 column even when the note has no H2 above it, and headings keep their indentation while the list is filtered. The highlighted heading has a tinted background and an accent bar on its left.

| Key | Action |
|---|---|
| Typing | Filters the list (fuzzy matching, like the quick switcher). The list stays in note order. |
| ↑ / ↓ | Move through the list |
| Tab | Autocomplete: fill the box with the highlighted heading |
| Enter | Move the text under the highlighted heading |
| Alt+A (configurable) | Switch between Append and Prepend |
| Esc | Cancel |

- Long headings are cut off with "…"; hover to see the full heading.
- Headings inside code blocks are not listed. Nor are headings inside the selection itself, since text can't move into itself.

### Append and Prepend

Below the search box sits a toggle like the ones in Obsidian's settings: **Prepend [toggle] Append (Alt+A)**. Switched to the left means Prepend, to the right means Append, and the active word is shown brighter. Click the toggle or either word, or press the hotkey shown in brackets.

- **Prepend:** directly below the heading line, above the content already there.
- **Append:** after the heading's own text, before its first subheading. Blank lines before the subheading stay where they are. If the heading has no text of its own, the text goes directly below the heading.

The toggle remembers your last choice, starting with Append.

### What moves

- **Nothing selected:** nothing moves; a notice asks you to select some text.
- **Whole lines** (the selection starts at a line start and ends at a line end): those lines move as they are, including list markers and indentation.
- **Part of a line:** a pop-up asks you to confirm first. Only the selected text moves, onto its own line(s) under the heading; the rest of the line stays.

Afterwards the cursor stays where the text was removed, or, if you choose **Follow the moved text** in the settings, the moved text is selected at its new place.

The move is a single edit: **Ctrl/Cmd+Z** undoes it in one step and **Ctrl+Y** (Cmd+Shift+Z on macOS) redoes it. If the note changes while the heading list is open (for example a sync), nothing moves and a notice says so.

## Lists: drag and drop and indentation lines

These features come from Outliner and behave as they do there.

### Drag and drop

- Press on a bullet, its checkbox or its fold arrow, then drag. The item moves with all its children.
- While dragging, a line shows where the item will land, and the target parent bullet is highlighted. Moving left or right picks the nesting level.
- Release to drop, or press **Escape** to cancel.
- Indentation is adjusted for the new level, and numbered lists are renumbered.
- If the note changes while you drag (for example a sync), the move is cancelled with a notice.
- Desktop only.

### Vertical indentation lines

- A thin line runs down from each bullet that has children, past its last child.
- Clicking a line runs the **click action**:
  - **Toggle folding** (default): folds every child of that bullet, or unfolds them if they are all folded already.
  - **None:** the lines are purely visual.
- While the lines are on, Obsidian's own indentation guides are hidden in lists so the two don't overlap.

Outliner only draws these lines with Obsidian's default theme. V2 draws them with any theme. With some themes they may sit slightly out of line with the bullets; turn **Draw vertical indentation lines** off if so.

## Core commands

With **Wrap useful core commands** on (the default), V2 adds a command for each of these Obsidian core commands:

| V2 command (palette shows "Quick Expand Selection V2: …") | Runs core command |
|---|---|
| Move line up | `editor:swap-line-up` |
| Move line down | `editor:swap-line-down` |
| Indent list | `editor:indent-list` |
| Unindent list | `editor:unindent-list` |
| Toggle fold on the current line | `editor:toggle-fold` |
| Fold more | `editor:fold-more` |
| Fold less | `editor:fold-less` |
| Fold all headings and lists | `editor:fold-all` |
| Unfold all headings and lists | `editor:unfold-all` |

Each V2 command simply runs the core command, so nothing is reimplemented. Their purpose is grouping: type "Quick Expand Selection V2" into the command palette and these appear beside Expand and Shrink selection.

- The names come from Obsidian, so they follow your interface language.
- The core commands, and any hotkeys on them, are untouched.
- The V2 versions have no default hotkeys. Assign them if you prefer to keep all of this plugin's hotkeys together.
- Turning the setting off removes the V2 commands straight away.

## Settings reference

### Move selection to note heading

| Setting | Default | Effect |
|---|---|---|
| Append/Prepend toggle hotkey | Alt+A | Switches the toggle while the heading list is open. Write modifiers plus one key, e.g. `Alt+A` or `Mod+Shift+P` (Mod is Ctrl, or Cmd on macOS). Letters match by key position, so Option+A works on macOS. |
| Cursor after moving | Stay where it was | Or **Follow the moved text**: select the text at its new place. |

### Core commands

| Setting | Default | Effect |
|---|---|---|
| Wrap useful core commands | On | Adds the V2 commands listed above. The settings page lists them by name. |

### Lists

| Setting | Default | Effect |
|---|---|---|
| Drag-and-drop | On | Drag bullets to move list items with their children. |
| Draw vertical indentation lines | On | Show lines beside nested bullets. |
| Vertical indentation line click action | Toggle folding | What clicking a line does: None or Toggle folding. |

### Expansion rules

| Setting | Default | Effect when off |
|---|---|---|
| List hierarchy | On | Bullets are treated as ordinary paragraph text. |
| Heading hierarchy | On | No heading steps: lists and paragraphs go straight to the whole note. On a heading line: word → heading line → whole note. |
| Sentences | On | Paragraphs go word → paragraph. |
| Code blocks | On | Code is treated like ordinary text. |
| LaTeX | On | Maths is treated like ordinary text. |
| Sentence end markers | `.!?。！？` | The characters that end a sentence. |

### Extra steps

Finer steps between the word and the structural levels, all **off** by default. They were the default behaviour of the original plugin.

| Setting | Adds a step for |
|---|---|
| Whitespace | the selection plus neighbouring spaces and tabs |
| Punctuation and symbols | the selection plus neighbouring punctuation |
| Brackets and Markdown markers | enclosing `( )`, `[ ]`, `{ }`, `**bold**`, `_italic_`, `` `code` `` and `~~strike~~` |
| Token | the run of non-space characters around the selection |
| Line within paragraph | the current line, before the whole paragraph |

**Reset expansion history** clears the shrink history for the current editor.

## Differences from the original plugins

### From Quick Expand Selection 1.0.3

- Lists step through each level: bullet with its children, then each parent with its children. The original went from a bullet to all its siblings at once.
- Lists, paragraphs and code blocks continue into the heading sections. The original jumped from a whole list or paragraph straight to the whole note.
- Sentences are a step, with configurable end markers.
- The whitespace, punctuation, bracket/marker, token and single-line steps are opt-in. In V2, settings saved by the original for whitespace, punctuation and lines are ignored once, so these start off.
- Bracket and Markdown-marker pairs are only looked for within the current line or paragraph, and `**bold**` is matched as a pair of `**` runs. `snake_case` underscores no longer count as italics.
- Headings inside code blocks are ignored.
- Default hotkeys (Ctrl/Cmd+A and Ctrl/Cmd+Shift+A).
- Adds Move selection to note heading, drag and drop, indentation lines and the core-command entries.

### From Outliner 4.10.2

Only drag and drop and the vertical indentation lines are included, with Outliner's defaults. The line click action offers None and Toggle folding; Outliner's Zoom in option is left out. V2 does not change Enter, Tab, Backspace, Ctrl/Cmd+A or cursor behaviour in lists, and has none of Outliner's other commands or list styling.

## Known limitations

- **Running alongside the original plugins.** If the original Quick Expand Selection is enabled with the same hotkeys, the two commands conflict; disable one. Outliner's drag and drop and lines would also run twice if Outliner is enabled, so turn those features off in one of them.
- **Lazy continuation lines.** A line directly under a bullet that is *not* indented (Markdown "lazy continuation") is not treated as part of the bullet.
- **Mixed tabs and spaces.** Indentation is measured with tabs counted to the next multiple of four columns.
- **Blockquotes and callouts** are treated as paragraphs; lists inside them are not recognised as lists.
- **Indentation lines with custom themes** may be slightly misaligned (see above).
- **Drag and drop** works only on desktop.
- **Core-command entries** use an undocumented but long-stable part of Obsidian (`app.commands`) to run the core commands. If a future Obsidian version renames a core command, its V2 entry does nothing until updated.

## Development

```bash
npm install
npm run check        # type-check, tests, build
npm run typecheck    # type-check only
npm test             # tests only
npm run build        # bundle src/ into main.js
npm run dev          # rebuild on change
```

Layout:

| Path | Contents |
|---|---|
| `src/selection.ts` | Expansion logic (pure functions, no Obsidian imports) |
| `src/main.ts` | Plugin entry: commands, settings loading/migration, feature wiring |
| `src/settings.ts` | Settings tab (`getSettingDefinitions`, with a `display()` fallback for older Obsidian) |
| `src/coreCommands.ts` | The wrapped core commands |
| `src/moveToHeading.ts` | Planning a move under a heading (pure functions) |
| `src/moveToHeadingModal.ts` | The heading list with the Append/Prepend toggle, and the partial-line confirmation |
| `src/hotkey.ts` | Parsing, matching and displaying the toggle hotkey setting |
| `src/i18n-core.ts`, `src/i18n.ts` | English and Simplified Chinese strings |
| `src/outliner/` | Code adapted from Outliner: list parser and model, editor wrapper, drag and drop, vertical lines |
| `styles.css` | Styles for the lines and drag and drop |
| `tests/` | `node:test` tests for expansion, moving under headings, hotkeys and locales |

**Type-checking:** V2's own code is checked with `strict`. The code in `src/outliner/` is checked with Outliner's own, looser settings (`tsconfig.outliner.json`), so it can stay close to upstream and later Outliner fixes are easy to merge. The only change from Outliner's code, apart from import paths and settings wiring, is that support for the Zoom plugin has been removed (from `editor.ts`, `VerticalLines.ts` and `Settings.ts`). `scripts/typecheck.mjs` runs both checks.

`@codemirror/*` and `obsidian` are external in the bundle. Obsidian provides them at runtime, and bundling a second copy of CodeMirror would break the editor extensions.

## Credits and licences

- **Quick Expand Selection** by [MuShan-bit](https://github.com/MuShan-bit), MIT licence (`LICENSE`).
- **Outliner** by [Viacheslav Slinko](https://github.com/vslinko), MIT licence. The adapted code is in `src/outliner/`, with its licence in `src/outliner/LICENSE`. `styles.css` is adapted from Outliner's stylesheet.
- V2 changes by [kittenwhisky](https://github.com/kittenwhisky).
