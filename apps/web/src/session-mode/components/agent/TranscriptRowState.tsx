import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const RowState = createContext<{
  row: string;
  values: Map<string, boolean>;
} | null>(null);
export function TranscriptRowState({
  row,
  values,
  children,
}: {
  row: string;
  values: Map<string, boolean>;
  children: ReactNode;
}) {
  const context = useMemo(() => ({ row, values }), [row, values]);
  return <RowState.Provider value={context}>{children}</RowState.Provider>;
}
/** Keep only expansion booleans when a row leaves the viewport, never its body. */
export function useTranscriptRowBoolean(
  key: string,
  initial = false,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const context = useContext(RowState);
  const identity = JSON.stringify([context?.row, key]);
  const [value, setValue] = useState(
    () => context?.values.get(identity) ?? initial,
  );
  const change = useCallback<Dispatch<SetStateAction<boolean>>>(
    (next) => {
      setValue((previous) => {
        const value = typeof next === "function" ? next(previous) : next;
        context?.values.set(identity, value);
        return value;
      });
    },
    [context, identity],
  );
  return [value, change];
}
