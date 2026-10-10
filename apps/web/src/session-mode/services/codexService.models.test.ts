import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadStart: vi.fn(),
  threadRead: vi.fn(),
  turnStart: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
import { codexService } from "./codexService";
import { useCodexStore, useConfigStore } from "../components/codex/stores";
import { followupParameters } from "./followupService";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import {
  changeThreadModel,
  hydrateThreadModel,
  useThreadModelStore,
} from "../stores/useThreadModelStore";

beforeEach(() => {
  vi.clearAllMocks();
  useThreadModelStore.setState({ threads: {} });
  useWorkspaceStore.setState({ cwd: "/project" });
  useCodexStore.setState({
    currentThreadId: null,
    activeThreadIds: [],
    threads: [],
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
  });
  useConfigStore.setState({
    model: "new-chat-default",
    modelProvider: "openai",
    reasoningEffort: "medium",
    threadCwdMode: "local",
    collaborationMode: "plan",
  });
  api.threadRead.mockImplementation(async ({ threadId }) => ({
    thread: { id: threadId, cwd: "/project", preview: "", turns: [] },
    model: threadId === "model-a" ? "gpt-6-astra" : "gpt-6-sol",
    modelProvider: "openai",
    reasoningEffort: threadId === "model-a" ? "high" : "low",
  }));
  api.turnStart.mockResolvedValue({
    turn: { id: "turn", status: "completed", items: [] },
  });
});

it("a selected model remains local to A and old runtime/history settings cannot overwrite it", async () => {
  await codexService.threadResume("model-a");
  await codexService.threadResume("model-b");
  changeThreadModel("model-a", {
    model: "gpt-6.1-sol",
    reasoningEffort: "xhigh",
  });
  await codexService.threadResume("model-a", undefined, { background: true });
  useCodexStore.setState({ currentThreadId: "model-b" });
  await codexService.turnStart("model-a", "A next turn");
  expect(api.turnStart.mock.calls.at(-1)?.[0]).toMatchObject({
    threadId: "model-a",
    model: "gpt-6.1-sol",
    effort: "xhigh",
  });
  expect(followupParameters("model-b")).toMatchObject({
    model: "gpt-6-sol",
    effort: "low",
  });
  expect(useConfigStore.getState().model).toBe("new-chat-default");
});

it("a late history request cannot undo a new selection or a newer native settings event", async () => {
  await codexService.threadResume("model-a");
  let resolve!: (r: unknown) => void;
  api.threadRead.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = codexService.threadResume("model-a", undefined, {
    background: true,
  });
  changeThreadModel("model-a", {
    model: "gpt-6.1-sol",
    reasoningEffort: "xhigh",
  });
  resolve({
    thread: { id: "model-a", preview: "", turns: [] },
    model: "gpt-6-astra",
    reasoningEffort: "high",
  });
  await pending;
  expect(followupParameters("model-a")).toMatchObject({
    model: "gpt-6.1-sol",
    effort: "xhigh",
  });
  hydrateThreadModel("model-a", {
    model: "gpt-6.1-sol",
    reasoningEffort: "xhigh",
  });
  const next = codexService.threadResume("model-a", undefined, {
    background: true,
  });
  hydrateThreadModel(
    "model-a",
    { model: "gpt-6-luna", reasoningEffort: "low" },
    { notify: true },
  );
  resolve({
    thread: { id: "model-a", preview: "", turns: [] },
    model: "gpt-6.1-sol",
    reasoningEffort: "xhigh",
  });
  await next;
  expect(followupParameters("model-a")).toMatchObject({
    model: "gpt-6-luna",
    effort: "low",
  });
});

it("an unknown existing thread never borrows the default for a new chat", async () => {
  await codexService.turnStart("unhydrated", "keep native settings");
  expect(api.turnStart.mock.calls.at(-1)?.[0]).toMatchObject({
    model: null,
    effort: null,
  });
  expect(
    api.turnStart.mock.calls.at(-1)?.[0].collaborationMode,
  ).toBeUndefined();
});

it("sends each resumed thread's actual model and effort even when another thread is selected", async () => {
  await codexService.threadResume("model-a", undefined, { background: true });
  await codexService.threadResume("model-b", undefined, { background: true });
  useCodexStore.setState({ currentThreadId: "model-a" });
  await codexService.turnStart("model-b", "send to B");
  expect(api.turnStart.mock.calls.at(-1)?.[0]).toMatchObject({
    threadId: "model-b",
    model: "gpt-6-sol",
    effort: "low",
    collaborationMode: {
      settings: { model: "gpt-6-sol", reasoning_effort: "low" },
    },
  });
  expect(followupParameters("model-a")).toMatchObject({
    model: "gpt-6-astra",
    effort: "high",
  });
  expect(followupParameters("model-b")).toMatchObject({
    model: "gpt-6-sol",
    effort: "low",
  });
});

it("a late new-thread response binds the default to its own thread without changing the new-chat selection", async () => {
  useConfigStore.setState({ model: "" });
  let resolve!: (r: unknown) => void;
  api.threadStart.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = codexService.threadStart({ shouldActivate: () => false });
  useConfigStore.getState().setModel("newer-choice");
  resolve({
    thread: { id: "model-created", cwd: "/project", preview: "", turns: [] },
    model: "server-default",
    modelProvider: "openai",
    reasoningEffort: "high",
  });
  await pending;
  expect(useConfigStore.getState().model).toBe("newer-choice");
  expect(followupParameters("model-created")).toMatchObject({
    model: "server-default",
    effort: "high",
  });
});

it("hydrates fresh CLI settings from the read-only thread and preserves them when fields are absent", async () => {
  api.threadRead.mockResolvedValueOnce({thread:{id:"from-cli",turns:[],model:"cli-model",modelProvider:"openai",reasoningEffort:"high"}});
  await codexService.loadThreadHistory("from-cli");
  expect(useThreadModelStore.getState().threads["from-cli"].model).toBe("cli-model");
  api.threadRead.mockResolvedValueOnce({thread:{id:"from-cli",turns:[]}});
  await codexService.loadThreadHistory("from-cli");
  expect(useThreadModelStore.getState().threads["from-cli"].reasoningEffort).toBe("high");
});

it("hydrates all native owner settings and sends them while another conversation and global defaults are selected", async () => {
  api.threadRead.mockResolvedValueOnce({thread:{id:"owned-settings",cwd:"/project",turns:[],model:"source-model",modelProvider:"openai",reasoningEffort:"high",serviceTier:"fast",approvalPolicy:"on-request",sandboxPolicy:{type:"readOnly",networkAccess:false},collaborationMode:{mode:"default",settings:{model:"source-model",reasoning_effort:"high",developer_instructions:null}}}});
  await codexService.loadThreadHistory("owned-settings");
  expect(useThreadModelStore.getState().threads["owned-settings"]).toMatchObject({serviceTier:"fast",sandbox:"read-only",approvalPolicy:"on-request",collaborationMode:"default"});
  useConfigStore.setState({serviceTier:"flex",sandbox:"danger-full-access",approvalPolicy:"never",collaborationMode:"plan"});
  useCodexStore.setState({currentThreadId:"other"});
  await codexService.turnStart("owned-settings","owner input");
  expect(api.turnStart.mock.calls.at(-1)?.[0]).toMatchObject({threadId:"owned-settings",serviceTier:"fast",approvalPolicy:"on-request",sandboxPolicy:{type:"readOnly",networkAccess:false},collaborationMode:{mode:"default"}});
});
