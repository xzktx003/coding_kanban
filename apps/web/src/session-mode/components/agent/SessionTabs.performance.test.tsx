import { act, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { SessionTabs } from "./SessionTabs";

const rendering = vi.hoisted(() => ({ title: vi.fn() }));
vi.mock("./SessionIdentity", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SessionIdentity")>();
  return {
    ...original,
    SessionIdentityTitle: (
      props: Parameters<typeof original.SessionIdentityTitle>[0],
    ) => {
      rendering.title(props.title);
      return original.SessionIdentityTitle(props);
    },
  };
});
vi.mock("@session/hooks/useSessionTabs", () => ({
  useSessionTabActions: () => ({ selectTab: vi.fn(), closeTab: vi.fn() }),
}));
vi.mock("../common/NewAgentButton", () => ({ NewAgentButton: () => null }));
vi.mock("../common/RenameSessionButton", () => ({
  RenameSessionButton: () => null,
}));

test("tab sync bookkeeping and focus changes do not rerender unrelated tab identities", () => {
  const cards = Array.from({ length: 30 }, (_, i) => ({
    kind: "codex" as const,
    id: `perf-${i}`,
    preview: `任务 ${i}`,
    cwd: "/fixture",
  }));
  useAgentCenterStore.setState({
    cards,
    currentAgentCardId: "perf-0",
    currentAgentCardKind: "codex",
  });
  render(<SessionTabs />);
  rendering.title.mockClear();
  act(() => useAgentCenterStore.setState({ nextTabSequence: 999 }));
  expect(rendering.title).not.toHaveBeenCalled();
  act(() =>
    useAgentCenterStore.getState().setCurrentAgentCardId("perf-1", "codex"),
  );
  expect(rendering.title.mock.calls.map(([title]) => title)).toEqual([
    "任务 0",
    "任务 1",
  ]);
});
