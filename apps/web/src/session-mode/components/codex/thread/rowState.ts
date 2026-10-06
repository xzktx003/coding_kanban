import {
  createContext,
  useCallback,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export const RowStateContext = createContext<Map<string, unknown> | null>(null);
/** Virtual rows unmount off screen; keep their disclosure state with the transcript. */
export function useTranscriptState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const cache = useContext(RowStateContext);
  const [value, setValue] = useState<T>(() =>
    cache?.has(key) ? (cache.get(key) as T) : initial,
  );
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((previous) => {
        const value =
          typeof next === "function"
            ? (next as (previous: T) => T)(previous)
            : next;
        cache?.set(key, value);
        return value;
      });
    },
    [cache, key],
  );
  return [value, update];
}
