import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionTabs } from "./SessionTabs";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useCodexStore } from "../codex/stores";
import { useCCStore } from "@session/stores/cc";
import { useSessionAttentionStore } from "@session/stores/useSessionAttentionStore";
vi.mock("@session/hooks/useSessionTabs", () => ({
  useSessionTabActions: () => ({
    selectTab: (card: any) =>
      useAgentCenterStore.getState().setCurrentAgentCardId(card.id, card.kind),
    closeTab: (card: any) => useAgentCenterStore.getState().removeCard(card),
  }),
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
beforeEach(() => {
  useSessionAttentionStore.setState({ receipts: {} });
  useCodexStore.setState({ threadStatusMap: {}, turnTimingMap: {} });
  useCCStore.setState({ sessionLoadingMap: {}, sessionMessagesMap: {} });
  useAgentCenterStore.setState({
    cards,
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
  });
});

it.each(["codex", "cc"] as const)(
  "%s tab shows one unread marker after completion and none after reading",
  (kind) => {
    useAgentCenterStore.setState({
      cards: [{ kind, id: "reply-session", preview: "回答完成" }],
    });
    render(<SessionTabs />);
    const tab = screen.getByRole("tab", { name: /回答完成/ });
    expect(
      within(tab).queryAllByRole("img", { name: "有新的回复未读" }),
    ).toHaveLength(0);
    act(() =>
      useSessionAttentionStore
        .getState()
        .complete(kind, "reply-session", "reply-1"),
    );
    expect(
      within(tab).getAllByRole("img", { name: "有新的回复未读" }),
    ).toHaveLength(1);
    act(() =>
      useSessionAttentionStore
        .getState()
        .complete(kind, "reply-session", "reply-2"),
    );
    expect(
      within(tab).getAllByRole("img", { name: "有新的回复未读" }),
    ).toHaveLength(1);
    act(() =>
      useSessionAttentionStore
        .getState()
        .read(kind, "reply-session", "reply-2"),
    );
    expect(
      within(tab).queryAllByRole("img", { name: "有新的回复未读" }),
    ).toHaveLength(0);
  },
);

it("running and pending status take precedence over an older unread reply", () => {
  useSessionAttentionStore.getState().complete("codex", "a", "older-reply");
  useCodexStore.setState({
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
  });
  render(<SessionTabs />);
  const tab = screen.getByRole("tab", { name: /修复登录/ });
  expect(within(tab).getByLabelText("运行中")).toBeTruthy();
  expect(
    within(tab).queryAllByRole("img", { name: "有新的回复未读" }),
  ).toHaveLength(0);
  act(() =>
    useCodexStore.setState({
      threadStatusMap: {
        a: { type: "active", activeFlags: ["waitingOnApproval"] },
      },
    }),
  );
  expect(within(tab).getByRole("img", { name: "待处理" })).toBeTruthy();
  expect(
    within(tab).queryAllByRole("img", { name: "有新的回复未读" }),
  ).toHaveLength(0);
});
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
    "修复登录",
    "实验结果",
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

it.each(["codex", "cc"] as const)("%s tab displays only its conversation title without an agent prefix", (kind) => {
  useAgentCenterStore.setState({ cards: [{kind, id: "plain-title", preview: "界面调整"}] });
  render(<SessionTabs />);
  const tab = screen.getByRole("tab", {name: "界面调整"});
  expect(tab.textContent).toBe("界面调整");
  expect(tab.querySelector(".session-tab-agent")).toBeNull();
});

it('distinguishes equal titles in different projects without filtering the followed set', () => {
  useCodexStore.setState({ threads: [] });
  useAgentCenterStore.setState({ cards: [
    { kind: 'codex', id: 'same-one', preview: '同名会话', cwd: '/work/alpha' },
    { kind: 'codex', id: 'same-two', preview: '同名会话', cwd: '/work/beta' },
  ], currentAgentCardId: 'same-one', currentAgentCardKind: 'codex' });
  render(<SessionTabs />);
  expect(screen.getByRole('tab', { name: '同名会话 · alpha' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '同名会话 · beta' })).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});
