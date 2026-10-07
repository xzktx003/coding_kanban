import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({
  acpStart: vi.fn(),
  acpCancel: vi.fn(),
  acpPrompt: vi.fn(),
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
