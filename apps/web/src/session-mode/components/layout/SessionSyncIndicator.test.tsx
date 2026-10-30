import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { SessionSyncIndicator } from "./SessionSyncIndicator";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useSessionSyncStore } from "../../stores/useSessionSyncStore";
import {
  beginConnectionCheck,
  connectionCheckFailed,
  connectionFailureText,
  SessionSyncError,
  useSessionConnectionDiagnostics,
} from "../../services/sessionConnectionDiagnostics";

beforeEach(() => {
  useAgentCenterStore.setState({
    tabSyncError: null,
    pendingTabOperations: [],
  });
  useWorkspaceStore.setState({
    projectSyncError: null,
    pendingProjectOperations: [],
  });
  useSessionSyncStore.setState({
    connection: "connected",
    connectionError: null,
  });
  useSessionConnectionDiagnostics.setState(
    useSessionConnectionDiagnostics.getInitialState(),
    true,
  );
});

it("keeps a read failure collapsed across recovery and another failure without moving focus", () => {
  render(
    <>
      <textarea aria-label="draft" />
      <SessionSyncIndicator />
    </>,
  );
  const draft = screen.getByRole("textbox");
  draft.focus();
  act(() => useAgentCenterStore.setState({ tabSyncError: "HTTP 503" }));
  const trigger = screen.getByRole("button", { name: /关注列表读取重试中/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(draft);
  fireEvent.click(trigger);
  expect(screen.queryByText(/修改已保存在本机/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起同步详情" }));
  act(() => useAgentCenterStore.setState({ tabSyncError: null }));
  act(() => useAgentCenterStore.setState({ tabSyncError: "HTTP 503 again" }));
  expect(
    screen
      .getByRole("button", { name: /同步待重试/ })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("automatically reveals a new local storage failure without stealing input focus", () => {
  render(
    <>
      <textarea aria-label="draft" />
      <SessionSyncIndicator />
    </>,
  );
  const draft = screen.getByRole("textbox");
  draft.focus();
  act(() => {
    beginConnectionCheck("tabs", "write", 1);
    connectionCheckFailed(
      "tabs",
      new DOMException("quota", "QuotaExceededError"),
      true,
    );
    useAgentCenterStore.setState({
      tabSyncError: connectionFailureText(
        useSessionConnectionDiagnostics.getState().tabs.failure,
      ),
    });
  });
  expect(screen.getByRole("alert").textContent).toContain(
    "本机同步记录无法读写",
  );
  expect(screen.queryByText(/修改已保存在本机/)).toBeNull();
  expect(document.activeElement).toBe(draft);
});

it("a separately broken real-time stream is visible while shared lists are healthy", () => {
  useSessionSyncStore.setState({ connection: "reconnecting" });
  render(<SessionSyncIndicator />);
  const trigger = screen.getByRole("button", { name: /实时连接恢复中/ });
  expect(trigger.getAttribute("aria-label")).toContain("任务状态待核对");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(screen.getByText("实时消息正在重新连接")).toBeTruthy();
  expect(screen.queryByText(/修改已保存在本机/)).toBeNull();
});

it("access errors remain actionable and a read retry never reports a saved modification", () => {
  beginConnectionCheck("projects");
  connectionCheckFailed("projects", new SessionSyncError("http", 403));
  useWorkspaceStore.setState({
    projectSyncError: connectionFailureText(
      useSessionConnectionDiagnostics.getState().projects.failure,
    ),
  });
  render(<SessionSyncIndicator />);
  expect(screen.getByText("服务返回 HTTP 403")).toBeTruthy();
  expect(screen.queryByText(/修改已保存在本机/)).toBeNull();
});
