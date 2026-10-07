import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionTabs } from "./SessionTabs";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
vi.mock("@session/hooks/useSessionTabs", () => ({
  useSessionTabActions: () => ({
    selectTab: (card: any) =>
      useAgentCenterStore.getState().setCurrentAgentCardId(card.id, card.kind),
    closeTab: (card: any) => useAgentCenterStore.getState().removeCard(card),
  }),
}));
vi.mock("../common/SessionStatus", () => ({
  SessionStatus: () => null,
  UnreadDot: () => null,
}));
vi.mock("../common/RenameSessionButton", () => ({
  RenameSessionButton: () => null,
}));
vi.mock("../common/NewAgentButton", () => ({
  NewAgentButton: () => <button>新聊天</button>,
}));
const cards = [
  { kind: "codex" as const, id: "a", preview: "修复登录", cwd: "/a" },
  { kind: "codex" as const, id: "b", preview: "实验结果", cwd: "/b" },
];
beforeEach(() =>
  useAgentCenterStore.setState({
    cards,
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
  }),
);
it("keeps the tab strip keyboard reachable while composing a new chat", () => {
  useAgentCenterStore.getState().setCurrentAgentCardId(null);
  render(<SessionTabs />);
  expect(screen.getAllByRole("tab")[0].tabIndex).toBe(0);
  expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe(
    "false",
  );
});
it("shows ordered, named tabs and changes the selected tab", () => {
  render(<SessionTabs />);
  expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual([
    "Codex修复登录",
    "Codex实验结果",
  ]);
  fireEvent.click(screen.getByRole("tab", { name: /实验结果/ }));
  expect(
    screen.getByRole("tab", { name: /实验结果/ }).getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "关闭标签：实验结果" }));
  expect(screen.queryByRole("tab", { name: /实验结果/ })).toBeNull();
  expect(
    screen.getByRole("tab", { name: /修复登录/ }).getAttribute("aria-selected"),
  ).toBe("true");
});
it("supports keyboard reorder and close without activating browser-wide shortcuts", () => {
  render(<SessionTabs />);
  fireEvent.keyDown(screen.getByRole("tab", { name: /修复登录/ }), {
    key: "ArrowRight",
    altKey: true,
    shiftKey: true,
  });
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "b",
    "a",
  ]);
  fireEvent.keyDown(screen.getByRole("tab", { name: /修复登录/ }), {
    key: "Delete",
  });
  expect(screen.getAllByRole("tab")).toHaveLength(1);
});
it("dragging reorders tabs without changing selection", () => {
  render(<SessionTabs />);
  const values = new Map<string, string>();
  const dataTransfer = {
    setData: (k: string, v: string) => values.set(k, v),
    getData: (k: string) => values.get(k),
    effectAllowed: "",
  };
  fireEvent.dragStart(
    screen.getByRole("tab", { name: /实验结果/ }).parentElement!,
    { dataTransfer },
  );
  fireEvent.dragOver(
    screen.getByRole("tab", { name: /修复登录/ }).parentElement!,
    { dataTransfer },
  );
  fireEvent.drop(screen.getByRole("tab", { name: /修复登录/ }).parentElement!, {
    dataTransfer,
  });
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "b",
    "a",
  ]);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
});
