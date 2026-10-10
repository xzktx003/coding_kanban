import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CodexAgentCard } from "./CodexAgentCard";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
const select = vi.hoisted(() => vi.fn());
vi.mock("@session/hooks/useSessionTabs", () => ({
  useSessionTabActions: () => ({ selectTab: select }),
}));
vi.mock("../common/SessionStatus", () => ({ useSessionState: () => "idle" }));
vi.mock("./useCardResize", () => ({
  useCardResize: () => ({
    size: {},
    startDrag: vi.fn(),
    onDragMove: vi.fn(),
    endDrag: vi.fn(),
  }),
}));
vi.mock("@session/components/codex/thread/CodexThread", () => ({
  CodexThread: () => null,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { loadThreadHistory: vi.fn(async () => {}) },
}));
beforeEach(() => {
  select.mockReset();
  useCodexStore.setState({
    events: {},
    historyLoadedMap: { A: true },
    activeThreadIds: ["A"],
    threadStatusMap: { A: { type: "idle" } },
  });
});
it("native citation role button within non-input A does not select A during capture", () => {
  const open = vi.fn();
  render(
    <CodexAgentCard
      card={{ kind: "codex", id: "A", cwd: "/A" }}
      isSelected={false}
      onRemove={() => {}}
      header={
        <span
          role="button"
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          source.ts
        </span>
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "source.ts" }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
it("explicit card background selection still chooses its owner", () => {
  render(
    <CodexAgentCard
      card={{ kind: "codex", id: "A", cwd: "/A" }}
      isSelected={false}
      onRemove={() => {}}
      header={<span>Card background</span>}
    />,
  );
  fireEvent.click(screen.getByText("Card background"));
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith({ kind: "codex", id: "A", cwd: "/A" });
});
