import { createElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { createCodexStoreForModule } from "./useCodexStore";
import type { CodexStore } from "./types";
import type { StateCreator } from "zustand";

const initializer = (version: number) =>
  ((
    _set: Parameters<StateCreator<CodexStore>>[0],
    get: Parameters<StateCreator<CodexStore>>[1],
  ) => ({
    events: {},
    currentThreadId: null,
    currentTurnId: null,
    versionAction: () => version,
    readCurrent: () => get().currentThreadId,
    ...(version > 1 ? { newField: "new default" } : {}),
  })) as unknown as StateCreator<CodexStore>;

it("shares one live store across module generations without retaining old transcript snapshots", () => {
  const data: Parameters<typeof createCodexStoreForModule>[0] = {};
  const first = createCodexStoreForModule(data, initializer(1));
  const firstEvents = { fixture: [{ payload: "old history" }] } as any;
  first.setState({
    events: firstEvents,
    currentThreadId: "current",
    currentTurnId: "in-progress",
  });
  const second = createCodexStoreForModule(data, initializer(2));
  expect(second).toBe(first);
  expect(data!.codexStore).toBe(first);
  expect(second.getState().events).toBe(firstEvents);
  expect(second.getState().currentTurnId).toBe("in-progress");
  expect((second.getState() as any).versionAction()).toBe(2);
  expect((second.getState() as any).readCurrent()).toBe("current");
  expect((second.getState() as any).newField).toBe("new default");
  const nextEvents = { fixture: [{ payload: "latest history" }] } as any;
  second.setState({ events: nextEvents });
  expect(first.getState().events).toBe(nextEvents);
});

it("creates independent stores outside HMR and preserves existing data when defaults grow", () => {
  const first = createCodexStoreForModule(undefined, initializer(1));
  const other = createCodexStoreForModule(undefined, initializer(1));
  expect(first).not.toBe(other);
  const data = { codexStore: first };
  first.setState({
    currentThreadId: "selected",
    newField: "user value",
  } as any);
  const same = createCodexStoreForModule(data, initializer(3));
  expect(same.getState().currentThreadId).toBe("selected");
  expect((same.getState() as any).newField).toBe("user value");
  expect((same.getState() as any).versionAction()).toBe(3);
});

it("keeps a mounted React subscriber on the same data while exposing replacement actions", () => {
  const data: Parameters<typeof createCodexStoreForModule>[0] = {};
  const store = createCodexStoreForModule(data, initializer(1));
  store.setState({
    currentThreadId: "keep-selected",
    currentTurnId: "busy-turn",
  });
  function Panel() {
    const selected = store((state) => state.currentThreadId);
    const busy = store((state) => state.currentTurnId);
    const action = store((state) => (state as any).versionAction);
    return createElement("p", null, `${selected}/${busy}/${action()}`);
  }
  render(createElement(Panel));
  expect(screen.getByText("keep-selected/busy-turn/1")).toBeTruthy();
  act(() => {
    createCodexStoreForModule(data, initializer(2));
  });
  expect(screen.getByText("keep-selected/busy-turn/2")).toBeTruthy();
});
