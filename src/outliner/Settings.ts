// Replaces Outliner's Settings service: only the values the vendored features read.
export type VerticalLinesAction = "none" | "zoom-in" | "toggle-folding";

export interface Settings {
  readonly dragAndDrop: boolean;
  readonly verticalLines: boolean;
  readonly verticalLinesAction: VerticalLinesAction;
  onChange(callback: () => void): void;
  removeCallback(callback: () => void): void;
}
