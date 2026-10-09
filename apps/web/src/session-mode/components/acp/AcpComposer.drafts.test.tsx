import {
  act,
  render,
  renderHook,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({
  acpStart: vi.fn(),
  acpCancel: vi.fn(),
  acpPrompt: vi.fn(),
  acpStop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@session/services/apiAdapt/acp", () => api);
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => true,
}));
vi.mock("./useAcpAgents", () => ({
  useAcpAgents: () => [
    { id: "draft-agent", available: true, command: "fixture", args: [] },
  ],
}));
vi.mock("./AcpSessionControls", () => ({ AcpSessionControls: () => null }));
vi.mock("@session/components/agent/AgentModelPanel", () => ({
  AgentModelPanel: () => null,
}));
vi.mock("@session/components/agent/AgentModelTrigger", () => ({
  AgentModelTrigger: () => null,
}));
import { AcpComposer } from "./AcpComposer";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import {
  ensureAttachmentDraft,
  useImageAttachments,
  useAttachmentDraftStore,
} from "../common/useImageAttachments";

test("automatic ACP connection associates the restored new-chat text and attachments with the created identity", async () => {
  const cwd = "/draft-project";
  const source = sessionDraftKey("acp", null, cwd, "draft-agent");
  const target = sessionDraftKey("acp", "created-acp", cwd, "draft-agent");
  useWorkspaceStore.setState({ cwd });
  useAcpStore.setState({
    active: true,
    agentId: "draft-agent",
    connectionId: null,
    sessionId: null,
    connecting: false,
    running: false,
  });
  useSessionDraftStore.setState({ drafts: {} });
  useSessionDraftStore
    .getState()
    .setText(source, "restored unfinished ACP text");
  const draft = renderHook(() => useImageAttachments(source));
  await act(async () => ensureAttachmentDraft(source));
  act(() => draft.result.current.addPaths(["/saved-before-connection.png"]));
  draft.unmount();
  api.acpStart.mockResolvedValue({
    connectionId: "created-connection",
    sessionId: "created-acp",
    initialize: {
      agentInfo: { name: "fixture" },
      agentCapabilities: {},
      authMethods: [],
    },
    session: { sessionId: "created-acp" },
  });
  render(
    <div className="session-mode">
      <AcpComposer />
    </div>,
  );
  await waitFor(() =>
    expect(useAcpStore.getState().sessionId).toBe("created-acp"),
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "restored unfinished ACP text",
  );
  expect(readDraft(source).text).toBe("");
  expect(readDraft(target).text).toBe("restored unfinished ACP text");
  await waitFor(() =>
    expect(useAttachmentDraftStore.getState().drafts[target]?.[0]?.path).toBe(
      "/saved-before-connection.png",
    ),
  );
  expect(api.acpCancel).not.toHaveBeenCalled();
  expect(api.acpPrompt).not.toHaveBeenCalled();
});

test("native history restoration blocks sending and automatic connection while preserving the draft", async () => {
  const cwd = "/restoring-project";
  useWorkspaceStore.setState({ cwd });
  useAcpStore.setState({
    active: true,
    agentId: "draft-agent",
    connectionId: null,
    sessionId: null,
    connecting: false,
    running: false,
    sessionTransition: { version: 99, label: "正在恢复会话…" },
  });
  useSessionDraftStore
    .getState()
    .setText(
      sessionDraftKey("acp", null, cwd, "draft-agent"),
      "恢复期间保留草稿",
    );
  api.acpStart.mockClear();
  api.acpPrompt.mockClear();
  const view = render(
    <div className="session-mode">
      <AcpComposer />
    </div>,
  );
  await act(async () => {});
  expect(api.acpStart).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "发送消息" }).hasAttribute("disabled"),
  ).toBe(true);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "恢复期间保留草稿",
  );
  view.unmount();
  useAcpStore.setState({ sessionTransition: null });
});

test("a delayed automatic connection cannot adopt the wrong Agent or move its draft", async () => {
  const cwd = "/late-connection";
  const source = sessionDraftKey("acp", null, cwd, "draft-agent");
  useWorkspaceStore.setState({ cwd });
  useAcpStore.setState({
    active: true,
    agentId: "draft-agent",
    connectionId: null,
    sessionId: null,
    connecting: false,
    running: false,
    sessionTransition: null,
    sessionTransitionError: null,
  });
  useSessionDraftStore.getState().setText(source, "原 Agent 草稿");
  let resolve!: (value: any) => void;
  api.acpStart.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  api.acpStart.mockClear();
  api.acpStop.mockClear();
  render(
    <div className="session-mode">
      <AcpComposer />
    </div>,
  );
  await waitFor(() => expect(api.acpStart).toHaveBeenCalledOnce());
  act(() => useAcpStore.getState().setAgentId("another-agent"));
  await act(async () =>
    resolve({
      connectionId: "undelivered-connection",
      sessionId: "late-session",
      initialize: { agentCapabilities: {}, authMethods: [] },
      session: { sessionId: "late-session" },
    }),
  );
  expect(useAcpStore.getState().agentId).toBe("another-agent");
  expect(useAcpStore.getState().connectionId).toBeNull();
  expect(useAcpStore.getState().sessionId).toBeNull();
  expect(readDraft(source).text).toBe("原 Agent 草稿");
  expect(api.acpStop).toHaveBeenCalledExactlyOnceWith("undelivered-connection");
  expect(useAcpStore.getState().connecting).toBe(false);
});

test("a late prompt error cannot mutate a different connection sharing the same session ID", async () => {
  const cwd = "/prompt-ownership";
  useWorkspaceStore.setState({ cwd });
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "draft-agent",
    connectionId: "old-connection",
    sessionId: "same-session",
    sessionCwd: cwd,
    entries: [],
  });
  useSessionDraftStore
    .getState()
    .setText(
      sessionDraftKey("acp", "same-session", cwd, "draft-agent"),
      "original prompt",
    );
  let reject!: (reason: Error) => void;
  api.acpPrompt.mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  render(
    <div className="session-mode">
      <AcpComposer />
    </div>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "发送消息" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(useAcpStore.getState().running).toBe(true));
  act(() =>
    useAcpStore.setState({
      connectionId: "new-connection",
      entries: [],
      running: true,
    }),
  );
  await act(async () => reject(new Error("late old connection")));
  expect(useAcpStore.getState().running).toBe(true);
  expect(useAcpStore.getState().entries).toEqual([]);
});

test("browsing another project cannot send into a native session rooted elsewhere", async () => {
  useAcpStore.getState().reset();
  useWorkspaceStore.setState({ cwd: "/browsed-project" });
  useAcpStore.setState({
    active: true,
    agentId: "draft-agent",
    connectionId: "connection",
    sessionId: "native-project-session",
    sessionCwd: "/native-project",
  } as any);
  useSessionDraftStore
    .getState()
    .setText(
      sessionDraftKey(
        "acp",
        "native-project-session",
        "/native-project",
        "draft-agent",
      ),
      "native project draft",
    );
  api.acpPrompt.mockClear();
  render(
    <div className="session-mode">
      <AcpComposer />
    </div>,
  );
  await act(async () => {});
  expect(
    screen.getByRole("button", { name: "发送消息" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText(/当前会话位于/)).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(api.acpPrompt).not.toHaveBeenCalled();
  act(() => useWorkspaceStore.setState({ cwd: "/native-project" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "发送消息" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  act(() => useWorkspaceStore.setState({ cwd: null }));
  expect(
    screen.getByRole("button", { name: "发送消息" }).hasAttribute("disabled"),
  ).toBe(true);
});
