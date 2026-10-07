import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useSessionName, useSessionNameStore } from "./useSessionNameStore";

beforeEach(() => useSessionNameStore.setState({ names: {}, sources: {} }));

test("a full browser storage does not crash the tab naming effect", () => {
  const failure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  try {
    const { result } = renderHook(() =>
      useSessionName("codex", "quota", "Name remains usable"),
    );
    expect(result.current).toBe("Name remains usable");
  } finally {
    failure.mockRestore();
  }
});

test("an established tab name stays fixed when the message preview changes", () => {
  const { result, rerender } = renderHook(
    ({ preview }) => useSessionName("codex", "stable", preview),
    {
      initialProps: { preview: "Initial task" },
    },
  );
  rerender({ preview: "An unrelated follow-up message" });
  expect(result.current).toBe("Initial task");
});

test("loading native history repairs a provisional corrupted label only once", () => {
  const { result, rerender } = renderHook(
    ({ preview, canonical }) =>
      useSessionName("codex", "recovered", preview, canonical),
    {
      initialProps: {
        preview: "Overwritten follow-up",
        canonical: undefined as string | undefined,
      },
    },
  );
  rerender({ preview: "Original task", canonical: "Original task" });
  expect(result.current).toBe("Original task");
  rerender({ preview: "Another message", canonical: "Another message" });
  expect(result.current).toBe("Original task");
});

test("manual names survive late native history and refresh hydration", async () => {
  useSessionNameStore.getState().setName("codex", "saved", "Manual title");
  useSessionNameStore
    .getState()
    .initializeName("codex", "saved", "Old history");
  const saved = localStorage.getItem("kanban.session.names")!;
  useSessionNameStore.setState({ names: {}, sources: {} });
  localStorage.setItem("kanban.session.names", saved);
  await useSessionNameStore.persist.rehydrate();
  expect(useSessionNameStore.getState().names["codex:saved"]).toBe(
    "Manual title",
  );
});

test("manual rename supersedes the established name and stays fixed", () => {
  const { result, rerender } = renderHook(
    ({ preview }) => useSessionName("codex", "manual", preview),
    {
      initialProps: { preview: "First message" },
    },
  );
  act(() =>
    useSessionNameStore.getState().setName("codex", "manual", "My name"),
  );
  rerender({ preview: "Later message" });
  expect(result.current).toBe("My name");
});
