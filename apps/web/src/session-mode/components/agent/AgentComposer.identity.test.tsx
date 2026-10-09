import { render, screen, act } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useCodexStore } from "@session/components/codex/stores";
import { useCCStore } from "@session/stores/cc";
import { AgentComposer } from "./AgentComposer";
vi.mock("@session/components/acp/AcpComposer", () => ({
  AcpComposer: ({ targetLabel }: any) => <div>{targetLabel}</div>,
}));
vi.mock("@session/components/cc/composer", () => ({
  Composer: ({ targetLabel }: any) => (
    <div data-testid="cc-sender">{targetLabel}</div>
  ),
}));
vi.mock("@session/components/codex/composer", () => ({
  Composer: ({ targetLabel }: any) => (
    <div data-testid="codex-sender">{targetLabel}</div>
  ),
}));
vi.mock("../common", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("../../hooks/useActiveSessionProject", () => ({
  useActiveSessionProject: () => ({
    path: "/fixture/project",
    label: "project",
  }),
}));

test("ACP input identifies the actual named session even when a Codex tab remains selected", () => {
  useAcpStore.setState({
    active: true,
    agentId: "fixture",
    agentTitle: "Fixture Agent",
    sessionId: "actual-session",
  });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "old-tab", preview: "不应发送的旧标签" }],
    currentAgentCardId: "old-tab",
    currentAgentCardKind: "codex",
  });
  useSessionNameStore.setState({
    names: {
      "acp:fixture:actual-session": "正在处理的 ACP 任务",
      "acp:fixture:next-session": "下一个 ACP 任务",
    },
  });
  render(<AgentComposer />);
  expect(screen.getByText("正在处理的 ACP 任务")).toBeTruthy();
  expect(screen.queryByText("不应发送的旧标签")).toBeNull();
  act(() => useAcpStore.getState().setSessionId("next-session"));
  expect(screen.getByText("下一个 ACP 任务")).toBeTruthy();
});

test("a Claude preference cannot route the focused Codex tab into a hidden Claude session", () => {
  useAcpStore.getState().reset();
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "focused-codex", preview: "目标 Codex" }],
    currentAgentCardId: "focused-codex",
    currentAgentCardKind: "codex",
    detachedCard: null,
  });
  useCodexStore.setState({ currentThreadId: "focused-codex" });
  useCCStore.setState({ activeSessionId: "hidden-claude" });
  render(<AgentComposer />);
  expect(screen.getByTestId("codex-sender")).toBeTruthy();
  expect(screen.queryByTestId("cc-sender")).toBeNull();
});
test("a Codex preference cannot route the focused Claude tab into a remembered Codex thread", () => {
  useAcpStore.getState().reset();
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAgentCenterStore.setState({
    cards: [{ kind: "cc", id: "focused-claude", preview: "目标 Claude" }],
    currentAgentCardId: "focused-claude",
    currentAgentCardKind: "cc",
    detachedCard: null,
  });
  useCCStore.setState({ activeSessionId: "focused-claude" });
  useCodexStore.setState({ currentThreadId: "hidden-codex" });
  render(<AgentComposer />);
  expect(screen.getByTestId("cc-sender")).toBeTruthy();
  expect(screen.queryByTestId("codex-sender")).toBeNull();
});

test("a just-created native thread does not claim its first-message title before it is followed", () => {
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAgentCenterStore.setState({
    cards: [],
    currentAgentCardId: null,
    detachedCard: null,
  });
  useCodexStore.setState({
    currentThreadId: "just-created",
    threads: [
      { id: "just-created", name: "原生占位名称", preview: "原生占位名称" },
    ] as any,
  });
  useSessionNameStore.setState({ names: {}, sources: {} });
  render(<AgentComposer />);
  expect(screen.getByText("原生占位名称")).toBeTruthy();
  expect(
    useSessionNameStore.getState().names["codex:just-created"],
  ).toBeUndefined();
});
