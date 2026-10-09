import { useEffect, useRef, useState } from "react";

/** Publish a changing value at most once per paint, keeping only its latest value. */
export function useAnimationFrameValue<T>(value: T, resetKey?: unknown): T {
  const [frameState, setFrameState] = useState({ resetKey, value });
  const latestValue = useRef({ resetKey, value });
  const frameId = useRef<number | null>(null);
  latestValue.current = { resetKey, value };
  const keyMatches = Object.is(frameState.resetKey, resetKey);

  useEffect(() => {
    if (!keyMatches) {
      if (frameId.current !== null) cancelAnimationFrame(frameId.current);
      frameId.current = null;
      setFrameState({ resetKey, value });
      return;
    }
    if (Object.is(frameState.value, value) || frameId.current !== null) return;
    frameId.current = requestAnimationFrame(() => {
      frameId.current = null;
      setFrameState(latestValue.current);
    });
  }, [frameState, keyMatches, resetKey, value]);

  useEffect(
    () => () => {
      if (frameId.current !== null) cancelAnimationFrame(frameId.current);
    },
    [],
  );

  return keyMatches ? frameState.value : value;
}
