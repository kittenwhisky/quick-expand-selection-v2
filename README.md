# Quick Expand Selection V2

Quick Expand Selection V2 is a fork of [Quick Expand Selection](https://github.com/mushan-bit/quick-expand-selection) by MuShan-bit. It adds two localized Obsidian editor commands:

- `Expand selection`
- `Shrink selection`

The command names and settings follow Obsidian's interface language (English, or Simplified Chinese). The commands default to **Ctrl/Cmd+A** (expand) and **Ctrl/Cmd+Shift+A** (shrink); change them in **Settings -> Hotkeys**. The final expansion step is the whole note, so select-all is never lost.

## Expansion order

Each press selects the next larger unit. Lists, paragraphs and code blocks lead into the heading steps, which end at the whole note.

| Cursor on | Steps |
|---|---|
| Bullet | word -> bullet line -> bullet with its children -> parent bullet with its children -> ... -> whole list -> heading section |
| Paragraph | word -> sentence -> paragraph -> heading section |
| Heading | word -> heading line -> heading section |
| Code block | word -> brackets/quotes -> line -> code block -> heading section (or the list item the block sits in) |
| LaTeX | brackets -> maths -> then as the surrounding bullet or paragraph |

A **heading section** runs from the heading to the next heading of the same or higher level. After it come each parent section and then the whole note. Text with no heading above it goes straight to the whole note.

- A whole list bridges blank lines between bullets and includes indented continuation lines.
- Sentences end at the configurable **sentence end markers** (default `.!?。！？`). Half-width markers need a following space or line end; full-width markers do not.
- Headings inside code blocks are ignored.

## Settings

- **Structure:** list hierarchy, heading hierarchy, sentences, code blocks, LaTeX (all on).
- **Extra steps** (all off): neighbouring whitespace, neighbouring punctuation, brackets and Markdown markers (`**bold**`, `_italic_`, `` `code` ``, `~~strike~~`), token (non-space run), and line within paragraph.

Shrinking follows the expansion history for the current editor and falls back to a collapsed cursor when no history remains. Any edit or manual selection change clears the history.

## Development

```bash
npm install
npm run check   # type-check, tests, build
```

Copy `main.js` and `manifest.json` into:

```text
<vault>/.obsidian/plugins/quick-expand-selection-v2/
```
