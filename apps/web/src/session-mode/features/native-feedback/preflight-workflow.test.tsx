import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SlashCommandDialogs } from "@session/components/codex/composer/SlashCommandDialogs";
import { useCodexStore } from "@session/components/codex/stores";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useThreadModelStore } from "@session/stores/useThreadModelStore";
import { usePairingStore } from "@session/stores/usePairingStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { sessionDraftKey, useSessionDraftStore } from "@session/stores/useSessionDraftStore";
import { feedbackUploads } from "./service";

const boundary = vi.hoisted(() => ({
  fetch: vi.fn(),
  streams: new Set<any>(),
  info: vi.fn(),
}));
vi.mock("@session/hooks/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/hooks/runtime")>()),
  buildUrl: (path: string) => "http://feedback-fixture.invalid" + path,
  authHeaders: () => ({ Authorization: "Bearer fixture-device" }),
  isDesktopTauri: () => false,
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: (subscriber: any) => {
    boundary.streams.add(subscriber);
    return () => boundary.streams.delete(subscriber);
  },
  isEventStreamConnected: () => true,
}));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: {
    info: boundary.info,
    danger: vi.fn(), success: vi.fn(), warning: vi.fn(),
  },
}));

const A = "feedback-thread-A", B = "feedback-thread-B", cwd = "/fixture/feedback-A";
const ownerA = sessionDraftKey("codex", A), ownerB = sessionDraftKey("codex", B);
const allowed = (runtimeInstance = "fixture-runtime-A") => ({
  reason: null, runtimeInstance,
  provenance: { config: "default", requirements: "unavailable", account: "native", workspace: "not-required" },
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const requests = (suffix: string) => boundary.fetch.mock.calls
  .filter(([url]) => String(url).endsWith(suffix))
  .map(([url, options]) => ({ url, options, body: JSON.parse(options.body) }));
const reads = () => requests("/api/codex/feedback/preflight");
const uploads = () => requests("/api/codex/feedback/upload");
let root: HTMLDivElement;
let stable: { drafts: string; defaults: string; model: string };
function unchanged() {
  expect(JSON.stringify(useSessionDraftStore.getState().drafts)).toBe(stable.drafts);
  expect(JSON.stringify(useConfigStore.getState())).toBe(stable.defaults);
  expect(JSON.stringify(useThreadModelStore.getState())).toBe(stable.model);
  expect(boundary.fetch.mock.calls.every(([url]) => /\/api\/codex\/feedback\/(preflight|upload)$/.test(String(url)))).toBe(true);
}
function host(open: "feedback" | null = "feedback", threadId: string | null = A, draftOwner = ownerA) {
  const close = vi.fn();
  // Spread preserves old component's real entry behavior before these captured props exist.
  const props = { open, onClose: close, threadId, cwd, draftOwner };
  return { ...render(<SlashCommandDialogs {...props} />, { container: root }), close };
}
const started = () => waitFor(() => expect(reads()).toHaveLength(1));
const form = () => screen.findByRole("dialog", { name: "提交反馈" });
function fillAndSubmit() {
  fireEvent.click(screen.getByRole("radio", { name: "结果异常" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  fixture feedback details  " } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function emit(method: string) {
  for (const stream of [...boundary.streams]) stream.onEvent({
    event: "codex:notification", payload: { method, params: {} }, seq: 1,
  });
}

beforeEach(() => {
  feedbackUploads.clear();
  boundary.streams.clear();
  boundary.info.mockReset();
  boundary.fetch.mockReset();
  vi.stubGlobal("fetch", boundary.fetch);
  boundary.fetch.mockImplementation(async (url) => {
    if (String(url).endsWith("/api/codex/feedback/preflight")) return response(allowed());
    if (String(url).endsWith("/api/codex/feedback/upload")) return response({ threadId: "fixture-feedback-result" });
    throw new Error("Unexpected fixture request: " + String(url));
  });
  useLayoutStore.setState({ view: "agent" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useWorkspaceStore.setState({ cwd });
  useCodexStore.setState({
    currentThreadId: A, account: { type: "apiKey" }, hasAccount: true, accountNamespace: null,
    threads: [{ id: A, cwd }, { id: B, cwd: "/fixture/feedback-B" }] as never,
  });
  usePairingStore.setState({
    selectedHost: "feedback-device.invalid",
    desktops: [{ name: "Fixture", host: "feedback-device.invalid", port: 41001, token: "fixture-device-A" }],
  });
  useSessionDraftStore.setState({ drafts: {
    [ownerA]: { text: "unsent A draft", revision: 1 },
    [ownerB]: { text: "unsent B draft", revision: 2 },
  } });
  stable = {
    drafts: JSON.stringify(useSessionDraftStore.getState().drafts),
    defaults: JSON.stringify(useConfigStore.getState()),
    model: JSON.stringify(useThreadModelStore.getState()),
  };
  root = document.createElement("div"); root.className = "session-mode";
  document.body.append(root);
});
afterEach(() => {
  cleanup(); feedbackUploads.clear(); root.remove(); vi.unstubAllGlobals();
});

it("opens the real slash-dialog host only after the authoritative allow, with no policy fields inferred on the frontend", async () => {
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  host(); await started();
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect(reads()[0].body).toEqual({ threadId: A });
  expect(reads()[0].options.method).toBe("POST");
  expect(reads()[0].options.signal).toBeInstanceOf(AbortSignal);
  expect(boundary.streams.size).toBe(1);
  await act(async () => finish(response(allowed())));
  expect(await form()).toBeTruthy();
  expect(uploads()).toEqual([]); expect(boundary.info).not.toHaveBeenCalled(); unchanged();
});

it("captures an explicit new-draft project cwd without borrowing a thread or asking for writer access", async () => {
  useCodexStore.setState({ currentThreadId: null });
  host("feedback", null, sessionDraftKey("codex", null, cwd));
  await form();
  expect(reads()).toHaveLength(1);
  expect(reads()[0].body).toEqual({ threadId: null, cwd });
  expect(uploads()).toEqual([]); unchanged();
});

it("rechecks immediately before handoff; a policy rejection uploads nothing and preserves the original undefined-close contract", async () => {
  boundary.fetch.mockResolvedValueOnce(response(allowed()))
    .mockResolvedValueOnce(response({ ...allowed(), reason: "policy" }));
  const { close } = host(); await form(); fillAndSubmit();
  await waitFor(() => expect(boundary.info).toHaveBeenCalledWith("你的组织已关闭反馈功能"));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(reads()).toHaveLength(2); expect(uploads()).toEqual([]);
  expect(feedbackUploads.getSnapshot()).toEqual([]); unchanged();
});

it("sends once with the captured thread, text and unchecked log consent after exactly two read-only preflights", async () => {
  let finish!: (value: Response) => void;
  boundary.fetch.mockResolvedValueOnce(response(allowed()))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  host(); await form(); fillAndSubmit();
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await waitFor(() => expect(reads()).toHaveLength(2));
  expect(uploads()).toEqual([]);
  await act(async () => finish(response(allowed())));
  await waitFor(() => expect(uploads()).toHaveLength(1));
  expect(uploads()[0].body).toEqual({ threadId: A, reason: "fixture feedback details", classification: "bad-result", includeLogs: false });
  expect(reads().map((r) => r.body)).toEqual([{ threadId: A }, { threadId: A }]);
  expect(feedbackUploads.getSnapshot()[0]).toMatchObject({ owner: ownerA, status: "uploaded" });
  unchanged();
});

it.each([
  ["policy", "你的组织已关闭反馈功能"],
  ["configuration", "反馈功能已在你的配置中关闭"],
  ["unavailable", "未能验证反馈权限。请重试"],
] as const)("reports %s as the original info notification before opening", async (reason, message) => {
  boundary.fetch.mockResolvedValueOnce(response({ ...allowed(), reason }));
  host(); await started();
  await waitFor(() => expect(boundary.info).toHaveBeenCalledWith(message));
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect(uploads()).toEqual([]); unchanged();
});

it.each([
  ["unsupported HTTP", () => response({ supported: false }, 404)],
  ["missing runtime", () => response({ reason: null, provenance: allowed().provenance })],
  ["unknown provenance", () => response({ ...allowed(), provenance: { ...allowed().provenance, account: "trusted-ui" } })],
  ["malformed reason", () => response({ ...allowed(), reason: false })],
] as const)("treats %s as unavailable rather than an authoritative missing/default allow", async (_name, reply) => {
  boundary.fetch.mockResolvedValueOnce(reply());
  host(); await started();
  await waitFor(() => expect(boundary.info).toHaveBeenCalledWith("未能验证反馈权限。请重试"));
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect(uploads()).toEqual([]); unchanged();
});

it.each([
  "thread ABA", "host ABA", "port", "device token", "account ABA", "same-value account event", "runtime restart", "hidden then shown", "leave then return",
] as const)("revokes a pending open across %s without reviving an old allow", async (kind) => {
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  host(); await started();
  await act(async () => {
    if (kind === "thread ABA") { useCodexStore.setState({ currentThreadId: B }); useCodexStore.setState({ currentThreadId: A }); }
    if (kind === "host ABA") { usePairingStore.setState({ selectedHost: "other.invalid" }); usePairingStore.setState({ selectedHost: "feedback-device.invalid" }); }
    if (kind === "port" || kind === "device token") usePairingStore.setState({ desktops: [{ ...usePairingStore.getState().desktops[0], ...(kind === "port" ? { port: 41002 } : { token: "fixture-device-B" }) }] });
    if (kind === "account ABA") { useCodexStore.setState({ account: { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" }, accountNamespace: "fixture-account-B" }); useCodexStore.setState({ account: { type: "apiKey" }, accountNamespace: null }); }
    if (kind === "same-value account event") emit("account/updated");
    if (kind === "runtime restart") window.dispatchEvent(new Event("session-runtime-restarted"));
    if (kind === "hidden then shown") { root.hidden = true; window.dispatchEvent(new Event("workbench-mode-changed")); }
    if (kind === "leave then return") useLayoutStore.setState({ view: "settings" });
  });
  if (kind === "hidden then shown") await act(async () => { root.hidden = false; window.dispatchEvent(new Event("workbench-mode-changed")); });
  if (kind === "leave then return") await act(async () => { useLayoutStore.setState({ view: "agent" }); });
  await act(async () => finish(response(allowed()))); await flush();
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect(reads()).toHaveLength(1); expect(uploads()).toEqual([]);
  expect(reads()[0].options.signal.aborted).toBe(true);
  expect(boundary.info).not.toHaveBeenCalled(); unchanged();
});

it("releases a pending read and its metadata observer on unmount", async () => {
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const mounted = host(); await started(); mounted.unmount();
  await act(async () => finish(response(allowed())));
  expect(reads()[0].options.signal.aborted).toBe(true);
  expect(boundary.streams.size).toBe(0); expect(uploads()).toEqual([]); unchanged();
});

it("refuses a changed runtime in the second successful receipt", async () => {
  boundary.fetch.mockResolvedValueOnce(response(allowed()))
    .mockResolvedValueOnce(response(allowed("fixture-runtime-B")));
  host(); await form(); fillAndSubmit();
  await waitFor(() => expect(boundary.info).toHaveBeenCalledWith("未能验证反馈权限。请重试"));
  expect(reads()).toHaveLength(2); expect(uploads()).toEqual([]); unchanged();
});

it("does not turn a plain event, absent detail or a side thread's feedback event into a main-thread request", async () => {
  host(null);
  await act(async () => {
    window.dispatchEvent(new Event("codex-open-feedback"));
    window.dispatchEvent(new CustomEvent("codex-open-feedback"));
    window.dispatchEvent(new CustomEvent("codex-open-feedback", { detail: { threadId: B, draftOwner: ownerB } }));
    window.dispatchEvent(new CustomEvent("codex-open-feedback", { detail: { threadId: A, draftOwner: ownerB } }));
  });
  expect(boundary.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull(); unchanged();
});

it("accepts an exact captured-target CustomEvent at the real visible host", async () => {
  host(null);
  await act(async () => window.dispatchEvent(new CustomEvent("codex-open-feedback", { detail: { threadId: A, draftOwner: ownerA } })));
  await form(); expect(reads().map((r) => r.body)).toEqual([{ threadId: A }]);
  expect(uploads()).toEqual([]); unchanged();
});

it("does not begin an invisible or non-agent feedback workflow", async () => {
  root.hidden = true; useLayoutStore.setState({ view: "settings" });
  host(); await flush();
  expect(boundary.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull(); unchanged();
});

it("keeps an authoritative form across only a plan display update within the same account namespace", async () => {
  useCodexStore.setState({ account: { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" }, accountNamespace: "fixture-account-A" });
  host(); await form();
  await act(async () => useCodexStore.setState({ account: { type: "chatgpt", email: "fixture@example.invalid", planType: "pro" } }));
  expect(screen.getByRole("dialog", { name: "提交反馈" })).toBeTruthy();
  fillAndSubmit();
  await waitFor(() => expect(uploads()).toHaveLength(1));
  expect(reads()).toHaveLength(2); expect(boundary.info).not.toHaveBeenCalled(); unchanged();
});

it("uses native authority for an existing thread whose canonical cwd differs from the captured global project", async () => {
  useCodexStore.setState({ threads: [{ id: A, cwd: "/fixture/native-canonical-project" }] as never });
  host(); await form();
  expect(reads()[0].body).toEqual({ threadId: A });
  expect(uploads()).toEqual([]); unchanged();
});

it("allows the authority to decide a complete new-draft snapshot even when its captured cwd is null", async () => {
  useCodexStore.setState({ currentThreadId: null }); useWorkspaceStore.setState({ cwd: null });
  render(<SlashCommandDialogs open="feedback" onClose={vi.fn()} {...{ threadId: null, cwd: null, draftOwner: sessionDraftKey("codex", null) }} />, { container: root });
  await form();
  expect(reads()[0].body).toEqual({ threadId: null, cwd: null });
  expect(boundary.info).not.toHaveBeenCalled(); expect(uploads()).toEqual([]); unchanged();
});

it("revokes a pending read across an actual hidden-attribute ABA even without a workbench event", async () => {
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  host(); await started();
  await act(async () => { root.hidden = true; root.hidden = false; });
  await act(async () => finish(response(allowed()))); await flush();
  expect(reads()[0].options.signal.aborted).toBe(true);
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect(reads()).toHaveLength(1); expect(uploads()).toEqual([]); expect(boundary.info).not.toHaveBeenCalled(); unchanged();
});

it.each(["thread ABA", "same-value account event", "hidden then shown", "unmount"] as const)("revokes the second pending preflight across %s before any upload handoff", async (kind) => {
  let finish!: (value: Response) => void;
  boundary.fetch.mockResolvedValueOnce(response(allowed()))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const mounted = host(); await form(); fillAndSubmit();
  await waitFor(() => expect(reads()).toHaveLength(2));
  await act(async () => {
    if (kind === "thread ABA") { useCodexStore.setState({ currentThreadId: B }); useCodexStore.setState({ currentThreadId: A }); }
    if (kind === "same-value account event") emit("account/updated");
    if (kind === "hidden then shown") { root.hidden = true; root.hidden = false; }
    if (kind === "unmount") mounted.unmount();
  });
  await act(async () => finish(response(allowed()))); await flush();
  expect(reads()[1].options.signal.aborted).toBe(true);
  expect(uploads()).toEqual([]); expect(feedbackUploads.getSnapshot()).toEqual([]);
  expect(boundary.streams.size).toBe(0); expect(boundary.info).not.toHaveBeenCalled(); unchanged();
});

it("bounds a stalled read, releases its timer and ignores a later allow without retrying", async () => {
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const timers = vi.spyOn(globalThis, "setTimeout"), cleared = vi.spyOn(globalThis, "clearTimeout");
  try {
    const mounted = host(); await started();
    const index = timers.mock.calls.findIndex((call) => call[1] === 15000);
    expect(index).toBeGreaterThanOrEqual(0);
    await act(async () => (timers.mock.calls[index][0] as () => void)());
    await waitFor(() => expect(boundary.info).toHaveBeenCalledWith("未能验证反馈权限。请重试"));
    expect(mounted.close).toHaveBeenCalledTimes(1);
    expect(cleared).toHaveBeenCalledWith(timers.mock.results[index].value);
    expect(reads()[0].options.signal.aborted).toBe(true); expect(boundary.streams.size).toBe(0);
    await act(async () => finish(response(allowed()))); await flush();
    expect(reads()).toHaveLength(1); expect(uploads()).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull(); unchanged();
  } finally { timers.mockRestore(); cleared.mockRestore(); }
});

it.each(["hidden", "layout"] as const)("allows a fresh slash request after %s revokes the previous mounted host", async (kind) => {
  const { useState } = await vi.importActual<typeof import("react")>("react");
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  function StatefulSlashHost() {
    const [open, setOpen] = useState<"feedback" | null>(null);
    return <><button onClick={() => setOpen("feedback")}>Fixture slash feedback</button><SlashCommandDialogs open={open} onClose={() => setOpen(null)} {...{ threadId: A, cwd, draftOwner: ownerA }} /></>;
  }
  render(<StatefulSlashHost />, { container: root });
  fireEvent.click(screen.getByRole("button", { name: "Fixture slash feedback" })); await started();
  await act(async () => {
    if (kind === "hidden") root.hidden = true;
    else useLayoutStore.setState({ view: "settings" });
  });
  await act(async () => {
    if (kind === "hidden") root.hidden = false;
    else useLayoutStore.setState({ view: "agent" });
  });
  await act(async () => finish(response(allowed()))); await flush();
  expect(reads()[0].options.signal.aborted).toBe(true);
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull(); expect(reads()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Fixture slash feedback" }));
  await waitFor(() => expect(reads()).toHaveLength(2)); await form();
  expect(uploads()).toEqual([]); expect(boundary.info).not.toHaveBeenCalled(); unchanged();
});

it.each(["other dialog", "new owner"] as const)("does not let a revoked old read close a later %s", async (kind) => {
  const { useState } = await vi.importActual<typeof import("react")>("react");
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const closed = vi.fn();
  function StatefulSlashHost() {
    const [open, setOpen] = useState<"feedback" | "model" | null>(null);
    const [threadId, setThreadId] = useState(A);
    return <>
      <button onClick={() => setOpen("feedback")}>Fixture slash feedback</button>
      <button onClick={() => {
        if (kind === "new owner") { useCodexStore.setState({ currentThreadId: B }); setThreadId(B); }
        setOpen("model");
      }}>Fixture other dialog</button>
      <output data-testid="fixture-dialog-state">{open ?? "closed"}</output>
      <SlashCommandDialogs open={open} onClose={() => { closed(threadId); setOpen(null); }} {...{ threadId, cwd, draftOwner: sessionDraftKey("codex", threadId) }} />
    </>;
  }
  render(<StatefulSlashHost />, { container: root });
  fireEvent.click(screen.getByRole("button", { name: "Fixture slash feedback" })); await started();
  fireEvent.click(screen.getByRole("button", { name: "Fixture other dialog" }));
  await act(async () => finish(response(allowed()))); await flush();
  expect(screen.getByTestId("fixture-dialog-state").textContent).toBe("model");
  expect(closed).not.toHaveBeenCalled();
  expect(reads()[0].options.signal.aborted).toBe(true);
  expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect(reads()).toHaveLength(1); expect(uploads()).toEqual([]); unchanged();
});

it("does not overlay feedback after a menu event's pending read is superseded by the user's actual model sheet", async () => {
  const { useState } = await vi.importActual<typeof import("react")>("react");
  const { ComposerSheet } = await vi.importActual<typeof import("@session/components/codex/composer/v2/ComposerSheet")>("@session/components/codex/composer/v2/ComposerSheet");
  let finish!: (value: Response) => void;
  boundary.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const closed = vi.fn();
  function StatefulMenuHost() {
    const [open, setOpen] = useState<"model" | null>(null);
    return <>
      <button onClick={() => setOpen("model")}>Fixture open model</button>
      <output data-testid="fixture-dialog-state">{open ?? "closed"}</output>
      {open === "model" && <ComposerSheet title="Fixture model panel" onClose={() => setOpen(null)}><span>Fixture model content</span></ComposerSheet>}
      <SlashCommandDialogs open={open} onClose={() => { closed(); setOpen(null); }} {...{ threadId: A, cwd, draftOwner: ownerA }} />
    </>;
  }
  render(<StatefulMenuHost />, { container: root });
  await act(async () => window.dispatchEvent(new CustomEvent("codex-open-feedback", { detail: { threadId: A, draftOwner: ownerA } })));
  await started(); expect(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Fixture open model" }));
  expect(await screen.findByRole("dialog", { name: "Fixture model panel" })).toBeTruthy();
  expect(uploads()).toEqual([]); expect(closed).not.toHaveBeenCalled(); unchanged();
  await act(async () => finish(response(allowed()))); await flush();
  expect(reads()).toHaveLength(1); expect(uploads()).toEqual([]); unchanged();
  expect.soft(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect.soft(screen.queryByRole("dialog", { name: "Fixture model panel" })).toBeTruthy();
  expect(screen.getByTestId("fixture-dialog-state").textContent).toBe("model");
  expect(closed).not.toHaveBeenCalled(); expect(reads()[0].options.signal.aborted).toBe(true);
});

it("does not start a menu feedback read while the user's actual model sheet is already open", async () => {
  const { ComposerSheet } = await vi.importActual<typeof import("@session/components/codex/composer/v2/ComposerSheet")>("@session/components/codex/composer/v2/ComposerSheet");
  const close = vi.fn();
  render(<>
    <ComposerSheet title="Fixture existing model panel" onClose={close}><span>Fixture model content</span></ComposerSheet>
    <SlashCommandDialogs open="model" onClose={close} {...{ threadId: A, cwd, draftOwner: ownerA }} />
  </>, { container: root });
  expect(await screen.findByRole("dialog", { name: "Fixture existing model panel" })).toBeTruthy();
  await act(async () => window.dispatchEvent(new CustomEvent("codex-open-feedback", { detail: { threadId: A, draftOwner: ownerA } })));
  await flush();
  expect(uploads()).toEqual([]); expect(close).not.toHaveBeenCalled(); unchanged();
  expect.soft(boundary.fetch).not.toHaveBeenCalled();
  expect.soft(screen.queryByRole("dialog", { name: "提交反馈" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Fixture existing model panel" })).toBeTruthy();
});
