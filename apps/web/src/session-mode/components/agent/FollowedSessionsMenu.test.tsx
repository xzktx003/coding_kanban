import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FollowedSessionsMenu } from "./FollowedSessionsMenu";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import {
  useCodexStore,
  useApprovalStore,
  usePermissionsStore,
  useRequestUserInputStore,
  useElicitationStore,
} from "../codex/stores";
import { useSessionAttentionStore } from "../../stores/useSessionAttentionStore";
import { useSessionSplitStore } from "../../stores/useSessionSplitStore";
const actions = vi.hoisted(() => ({ selectTab: vi.fn(async () => {}) }));
vi.mock("../../hooks/useSessionTabs", () => ({
  useSessionTabActions: () => actions,
}));
const cards = [
  {
    kind: "codex" as const,
    id: "running",
    preview: "持续运行的会话",
    cwd: "/company/api",
  },
  {
    kind: "codex" as const,
    id: "reply",
    preview: "有新回复的会话",
    cwd: "/research/api",
  },
  { kind: "codex" as const, id: "approval", preview: "等待审批的会话" },
  {
    kind: "codex" as const,
    id: "failure",
    preview: "执行失败的会话",
    cwd: "/work/app",
  },
];
beforeEach(() => {
  actions.selectTab.mockClear();
  useAgentCenterStore.setState({
    cards,
    sharedTabsInitialized: true,
    currentAgentCardId: "running",
    currentAgentCardKind: "codex",
    tabSyncError: null,
  });
  useCodexStore.setState({
    threads: [],
    events: {},
    turnTimingMap: {},
    currentThreadId: null,
    currentTurnId: null,
    threadStatusMap: {
      running: { type: "active", activeFlags: [] },
      reply: { type: "idle" },
      approval: { type: "active", activeFlags: ["waitingOnApproval"] },
      failure: { type: "systemError" },
    },
  });
  useApprovalStore.setState({ pendingApprovals: [], currentApproval: null });
  usePermissionsStore.setState({ pendingRequests: [] });
  useRequestUserInputStore.setState({
    pendingRequests: [],
    currentRequest: null,
  });
  useElicitationStore.setState({ pendingRequests: [] });
  useSessionAttentionStore.setState({ receipts: {} });
  useSessionAttentionStore.getState().complete("codex", "reply", "new-reply");
  useSessionSplitStore.setState({
    activeGroupId: "test-group",
    tree: {
      type: "group",
      id: "test-group",
      keys: cards.map((c) => `codex:${c.id}`),
      selected: "codex:running",
    },
  });
});
function open() {
  const view = render(
    <div className="session-mode">
      <FollowedSessionsMenu />
    </div>,
  );
  fireEvent.keyDown(
    screen.getByRole("button", { name: "全部关注会话与窗口组" }),
    { key: "Enter" },
  );
  return view;
}
it("shows shared running, unread, approval and failure markers plus each session's own project", async () => {
  open();
  const menu = await screen.findByRole("menu");
  const running = within(menu).getByRole("menuitem", {
    name: /持续运行的会话/,
  });
  expect(running.querySelector(".session-status-spin")).not.toBeNull();
  expect(running.getAttribute("aria-current")).toBe("page");
  expect(within(running).getByText("company/api")).toBeTruthy();
  const unread = within(menu).getByRole("menuitem", { name: /有新回复的会话/ });
  expect(
    within(unread).getByRole("img", { name: "有新的回复未读" }),
  ).toBeTruthy();
  expect(within(unread).getByText("research/api")).toBeTruthy();
  expect(
    within(menu)
      .getByRole("menuitem", { name: /等待审批的会话/ })
      .querySelector('.session-status-dot[data-state="pending"]'),
  ).not.toBeNull();
  expect(
    within(menu)
      .getByRole("menuitem", { name: /执行失败的会话/ })
      .querySelector('.session-status-dot[data-state="failed"]'),
  ).not.toBeNull();
  expect(actions.selectTab).not.toHaveBeenCalled();
});
it("updates live in an open menu and clears the blue dot once the reply is read", async () => {
  open();
  const menu = await screen.findByRole("menu");
  act(() =>
    useCodexStore.setState({
      threadStatusMap: {
        running: { type: "systemError" },
        reply: { type: "idle" },
      },
    }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("menuitem", { name: /持续运行的会话/ })
        .querySelector('.session-status-dot[data-state="failed"]'),
    ).not.toBeNull(),
  );
  act(() =>
    useSessionAttentionStore.getState().read("codex", "reply", "new-reply"),
  );
  await waitFor(() => {
    const reply = screen.getByRole("menuitem", { name: /有新回复的会话/ });
    expect(
      reply.querySelector('.session-status-dot[data-state="unread"]'),
    ).toBeNull();
    expect(within(reply).getByText("已完成")).toBeTruthy();
  });
});
it("does not show stale running markers while offline and keeps navigation disabled", async () => {
  render(
    <div className="session-mode">
      <FollowedSessionsMenu status="offline" />
    </div>,
  );
  fireEvent.keyDown(
    screen.getByRole("button", { name: "全部关注会话与窗口组" }),
    { key: "Enter" },
  );
  const menu = await screen.findByRole("menu");
  expect(menu.querySelector(".session-status-spin")).toBeNull();
  expect(
    menu.querySelector('[data-state="unknown"] [aria-label="状态待同步"]'),
  ).not.toBeNull();
  for (const item of within(menu).getAllByRole("menuitem"))
    expect(item.getAttribute("data-disabled")).not.toBeNull();
  expect(actions.selectTab).not.toHaveBeenCalled();
});
it("selects exactly the chosen conversation through the existing tab actions", async () => {
  open();
  const menu = await screen.findByRole("menu");
  fireEvent.click(
    within(menu).getByRole("menuitem", { name: /有新回复的会话/ }),
  );
  expect(actions.selectTab).toHaveBeenCalledExactlyOnceWith(cards[1]);
});
