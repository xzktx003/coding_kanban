export interface TerminalViewRenderProps {
  agentSessionId: string;
  onReady?: () => void;
  onFontSizeChange?: (fontSize: number) => void;
  fontSize?: number;
  inputEnabled?: boolean;
  interactive?: boolean;
  mobileTouchMode?: boolean;
  preferLocalMouseSelection?: boolean;
  restoreBracketedPasteMode?: boolean;
  suspended?: boolean;
  tmuxMouseReporting?: boolean;
  visible?: boolean;
  wheelPassthrough?: boolean;
}

export function terminalViewPropsAreEqual(
  previous: TerminalViewRenderProps,
  next: TerminalViewRenderProps,
): boolean {
  const keys = Object.keys(previous) as (keyof TerminalViewRenderProps)[];
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => Object.is(previous[key], next[key]))
  );
}
