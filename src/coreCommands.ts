import type { App, Plugin } from "obsidian";

/**
 * Core editor commands that sit naturally beside expand/shrink selection. V2 registers a thin
 * command for each that just runs the core command, so filtering the command palette by this
 * plugin's name lists them all together. The core commands themselves are left untouched.
 */
export const WRAPPED_CORE_COMMANDS: ReadonlyArray<{ id: string; fallbackName: string }> = [
  { id: "editor:swap-line-up", fallbackName: "Move line up" },
  { id: "editor:swap-line-down", fallbackName: "Move line down" },
  { id: "editor:indent-list", fallbackName: "Indent list" },
  { id: "editor:unindent-list", fallbackName: "Unindent list" },
  { id: "editor:toggle-fold", fallbackName: "Toggle fold on the current line" },
  { id: "editor:fold-more", fallbackName: "Fold more" },
  { id: "editor:fold-less", fallbackName: "Fold less" },
  { id: "editor:fold-all", fallbackName: "Fold all headings and lists" },
  { id: "editor:unfold-all", fallbackName: "Unfold all headings and lists" }
];

interface CommandRegistry {
  commands: Record<string, { name: string } | undefined>;
  executeCommandById(id: string): boolean;
}

// `app.commands` is not part of Obsidian's public API, but is stable and widely used by plugins.
function registry(app: App): CommandRegistry {
  return (app as unknown as { commands: CommandRegistry }).commands;
}

/** The core command's own (localised) name, without any "Editor: "-style prefix. */
export function coreCommandName(app: App, id: string, fallbackName: string): string {
  const name = registry(app).commands[id]?.name ?? fallbackName;
  return name.replace(/^[^:]+:\s*/u, "");
}

function wrapperId(coreId: string): string {
  return `core-${coreId.replace(/^editor:/u, "")}`;
}

export function registerCoreCommandWrappers(plugin: Plugin): void {
  for (const { id, fallbackName } of WRAPPED_CORE_COMMANDS) {
    plugin.addCommand({
      id: wrapperId(id),
      name: coreCommandName(plugin.app, id, fallbackName),
      editorCallback: () => {
        registry(plugin.app).executeCommandById(id);
      }
    });
  }
}

export function removeCoreCommandWrappers(plugin: Plugin): void {
  for (const { id } of WRAPPED_CORE_COMMANDS) plugin.removeCommand(wrapperId(id));
}
