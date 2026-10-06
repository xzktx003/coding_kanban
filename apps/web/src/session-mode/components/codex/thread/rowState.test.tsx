import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ReactNode } from "react";
import { RowStateContext, useTranscriptState } from "./rowState";
it("restores disclosure state after a virtual row remount without sharing other rows", () => {
  const state = new Map<string, unknown>();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RowStateContext.Provider value={state}>
      {children}
    </RowStateContext.Provider>
  );
  const first = renderHook(() => useTranscriptState("command", false), {
    wrapper,
  });
  act(() => first.result.current[1](true));
  first.unmount();
  const second = renderHook(() => useTranscriptState("command", false), {
    wrapper,
  });
  expect(second.result.current[0]).toBe(true);
  const other = renderHook(() => useTranscriptState("other", false), {
    wrapper,
  });
  expect(other.result.current[0]).toBe(false);
});
