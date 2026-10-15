import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  openCommandDetail,
  type CommandDetailItem,
  type CommandDetailTarget,
  type CommandDetailFailure,
} from "./commandDetail";
type State = {
  phase: "unloaded" | "loading" | "ready" | CommandDetailFailure;
};
const unloaded: State = { phase: "unloaded" };
/** The full native object and every display derivation belong to this local row. */
export function useCommandDetail(
  target: CommandDetailTarget,
  visible: boolean,
) {
  const [state, setState] = useState<State>(unloaded);
  // React keeps an alternate render; a mutable ref lets close clear both copies.
  const itemRef = useRef<CommandDetailItem | null>(null);
  const generation = useRef(0),
    release = useRef<(() => void) | null>(null);
  const clear = useCallback(() => {
    generation.current++;
    itemRef.current = null;
    release.current?.();
    release.current = null;
    setState(unloaded);
  }, []);
  useLayoutEffect(() => {
    if (!visible) clear();
    return clear;
  }, [visible, target.threadId, target.turnId, target.itemId, clear]);
  const load = useCallback(() => {
    clear();
    if (!visible || document.visibilityState === "hidden") return;
    const captured = generation.current;
    setState({ phase: "loading" });
    release.current = openCommandDetail(target, {
      success: (item) => {
        if (generation.current === captured) {
          itemRef.current = item;
          setState({ phase: "ready" });
        }
      },
      failure: (phase) => {
        if (generation.current === captured) setState({ phase });
      },
      invalidate: clear,
    });
  }, [clear, visible, target.threadId, target.turnId, target.itemId]);
  return {
    state: visible ? state : unloaded,
    itemRef,
    load,
    clear,
  };
}
