import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zh } from "@session/locales/zh";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";
import { sessionDraftKey, useSessionDraftStore, useSessionTextDraft } from "@session/stores/useSessionDraftStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useConfigStore } from "../stores/useConfigStore";
import { AccessModePopover } from "./AccessModePopover";
import { ComposerToolbarProvider } from "./ComposerToolbarContext";
import { ComposerSheet } from "./v2/ComposerSheet";

const external = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@session/browser-opener", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/browser-opener")>()),
  // Preserve the actual module's openUrl === open alias relationship.
  open: external.open, openUrl: external.open,
}));

const rpc = vi.hoisted(() => ({
  threadStart: vi.fn(), turnStart: vi.fn(), turnSteer: vi.fn(),
  turnInterrupt: vi.fn(), respondToPermissionsApproval: vi.fn(),
}));
// Keep the real settings/confirmation/primitive chain. Only outgoing business
// transports are denied and counted; no ask/modal/readiness hook is mocked.
vi.mock("@session/services/apiAdapt/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt/codex")>()), ...rpc,
}));

const OFFICIAL_LEARN_MORE_URL = "https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it";
let expectedExternalOpenCalls = 0;
const A = "r26-permission-owner-a";
const B = "r26-permission-owner-b";
const OWNER_A = sessionDraftKey("codex", A);
const OWNER_B = sessionDraftKey("codex", B);
const OWNER_DEFAULT = sessionDraftKey("codex", null, "/r26/synthetic-default-workspace");
const TEXT_A = "R26 主目标未发送草稿";
const TEXT_B = "R26 非活动目标草稿";
const TEXT_DEFAULT = "R26 新草稿默认目标";
const locale = createInstance();
const CAPABILITIES = [
  { title: "文件和文件夹", description: "读取、创建、修改、上传或删除此计算机上任意位置的文件" },
  { title: "终端命令", description: "运行命令、安装软件和更改系统设置" },
  { title: "互联网和已连接的应用", description: "访问网站、发送数据并使用已启用的插件" },
];

type Mode = "main" | "expanded";

// This unit-only owner/editor harness is not the full Composer or a browser.
// Main and expanded both retain their actual AccessModePopover instances.
// Expanded uses the real ComposerSheet, Dialog/Portal and history effect.
function PermissionOwnerHarness({ mode, onSubmit, onSheetClose }: {
  mode: Mode; onSubmit: () => void; onSheetClose: () => void;
}) {
  const { inputValue, setInputValue } = useSessionTextDraft(OWNER_A);
  const [expanded, setExpanded] = useState(false);
  return (
    <I18nextProvider i18n={locale}>
      <div className="session-mode" onSubmitCapture={(event) => { event.preventDefault(); onSubmit(); }}>
        {mode === "expanded" && (
          <button type="button" onClick={() => setExpanded(true)} aria-label="R26 打开展开编辑">展开编辑</button>
        )}
        <section className="session-codex-composer" data-draft-owner={OWNER_A}>
          <form>
            <textarea data-r26-editor="main" aria-label="R26 主输入草稿" value={inputValue} onChange={(event) => setInputValue(event.currentTarget.value)} />
            <ComposerToolbarProvider>
              <AccessModePopover compact threadId={A} />
            </ComposerToolbarProvider>
          </form>
        </section>
        {expanded && (
          <ComposerSheet
            full
            title="展开编辑"
            description="返回会保留正文、上下文与代码；发送方式沿用当前设置。"
            onClose={() => { onSheetClose(); setExpanded(false); }}
            footer={<AccessModePopover compact threadId={A} />}
          >
            <div data-draft-owner={OWNER_A}>
              <textarea data-r26-editor="expanded" aria-label="R26 展开输入草稿" value={inputValue} onChange={(event) => setInputValue(event.currentTarget.value)} />
            </div>
          </ComposerSheet>
        )}
      </div>
    </I18nextProvider>
  );
}

function serializableProtectedState() {
  const codex = useCodexStore.getState();
  return JSON.parse(JSON.stringify({
    threads: useThreadModelStore.getState().threads,
    defaults: useConfigStore.getState(),
    drafts: useSessionDraftStore.getState().drafts,
    currentThreadId: codex.currentThreadId,
    inputFocusTrigger: codex.inputFocusTrigger,
  }));
}

async function mountSurface(mode: Mode) {
  const before = {
    threads: useThreadModelStore.getState().threads,
    defaults: useConfigStore.getState(),
    drafts: useSessionDraftStore.getState().drafts,
    snapshot: serializableProtectedState(),
  };
  // Hard fixture prerequisites: three independently initialized setting/draft
  // targets, not a mocked ready flag or a snapshot manufactured after action.
  expect(before.threads[A]).toMatchObject({
    model: "r26-ordinary-a", modelProvider: "openai", reasoningEffort: "medium", serviceTier: null,
    sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user", collaborationMode: "default",
  });
  expect(before.threads[B]).toMatchObject({
    model: "r26-inactive-b", modelProvider: "openai", reasoningEffort: "low", serviceTier: "priority",
    sandbox: "read-only", approvalPolicy: "untrusted", approvalsReviewer: "user", collaborationMode: "default",
  });
  expect(before.threads[A]).not.toBe(before.threads[B]);
  expect(before.defaults).toMatchObject({
    model: "r26-new-default", reasoningEffort: "xhigh", sandbox: "danger-full-access", approvalPolicy: "never",
  });
  expect(before.drafts[OWNER_A]).toMatchObject({ text: TEXT_A });
  expect(before.drafts[OWNER_B]).toMatchObject({ text: TEXT_B });
  expect(before.drafts[OWNER_DEFAULT]).toMatchObject({ text: TEXT_DEFAULT });
  const onSubmit = vi.fn();
  const onSheetClose = vi.fn();
  const view = render(<PermissionOwnerHarness mode={mode} onSubmit={onSubmit} onSheetClose={onSheetClose} />);
  // The real workbench root exists before a user opens the expanded Sheet.
  // Keep the same order here so both Sheet and later menu portals target it.
  if (mode === "expanded") {
    fireEvent.click(within(view.container).getByRole("button", { name: "R26 打开展开编辑" }));
    await screen.findByRole("dialog", { name: "展开编辑" });
  }
  const mainEditor = document.querySelector<HTMLTextAreaElement>("[data-r26-editor=main]");
  const expandedEditor = document.querySelector<HTMLTextAreaElement>("[data-r26-editor=expanded]");
  expect(mainEditor).not.toBeNull();
  if (mode === "expanded") expect(expandedEditor).not.toBeNull();
  const scope = mode === "expanded"
    ? screen.getByRole("dialog", { name: "展开编辑" })
    : view.container.querySelector<HTMLElement>(".session-codex-composer");
  expect(scope).not.toBeNull();
  const trigger = within(scope!).getByRole("button", { name: /^执行权限：/ });
  return { ...view, mode, before, mainEditor: mainEditor!, expandedEditor, trigger, onSubmit, onSheetClose };
}
type Surface = Awaited<ReturnType<typeof mountSurface>>;

function assertNoIO() {
  for (const method of Object.values(rpc)) expect(method).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
}
function assertProtected(surface: Surface, options?: { unmounted: true }) {
  expect(useThreadModelStore.getState().threads).toBe(surface.before.threads);
  expect(useConfigStore.getState()).toBe(surface.before.defaults);
  expect(useSessionDraftStore.getState().drafts).toBe(surface.before.drafts);
  expect(serializableProtectedState()).toEqual(surface.before.snapshot);
  expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(surface.mainEditor.value).toBe(TEXT_A);
  expect(surface.mainEditor.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(OWNER_A);
  if (!options?.unmounted) expect(surface.mainEditor.isConnected).toBe(true);
  if (surface.mode === "expanded") {
    expect(surface.expandedEditor?.value).toBe(TEXT_A);
    expect(surface.expandedEditor?.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(OWNER_A);
    if (!options?.unmounted) expect(surface.expandedEditor?.isConnected).toBe(true);
  }
  expect(surface.onSubmit).not.toHaveBeenCalled();
  expect(surface.onSheetClose).not.toHaveBeenCalled();
  assertNoIO();
}
async function settleReactTasks() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}
async function openFullAccess(surface: Surface) {
  assertProtected(surface);
  fireEvent.keyDown(surface.trigger, { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  const row = within(menu).getByRole("menuitemradio", { name: /完全访问权限/ });
  expect(row.getAttribute("data-disabled")).toBeNull();
  assertProtected(surface);
  fireEvent.pointerDown(row, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(row);
  // Accept old/new title here so the entry is a hard prerequisite, not the RED.
  const dialog = await screen.findByRole("dialog", { name: /访问权限/ });
  assertProtected(surface);
  return dialog;
}
type CloseStage = "cancel" | "Escape" | "content-cleanup" | "link-cleanup";
function readCloseDiagnosticNode(node: Element | null) {
  if (!node) return null;
  return {
    tagName: node.tagName,
    id: node.id || null,
    role: node.getAttribute("role"),
    dataState: node.getAttribute("data-state"),
    isConnected: node.isConnected,
    ariaHidden: node.getAttribute("aria-hidden"),
    inert: node.hasAttribute("inert"),
  };
}
function readImmediateEscapeDiagnostic(dialog: HTMLElement, dispatch: () => void) {
  const doc = dialog.ownerDocument;
  const entries: unknown[] = [];
  const limit = 8;
  let dropped = 0;
  const record = (phase: string, event?: KeyboardEvent) => {
    if (entries.length === limit) { dropped += 1; return; }
    entries.push({
      phase,
      event: event ? {
        key: event.key,
        code: event.code,
        eventPhase: event.eventPhase,
        defaultPrevented: event.defaultPrevented,
        cancelable: event.cancelable,
        bubbles: event.bubbles,
        isTrusted: event.isTrusted,
        target: event.target instanceof Element ? readCloseDiagnosticNode(event.target) : null,
        currentTargetIsDocument: event.currentTarget === doc,
      } : null,
      dialog: readCloseDiagnosticNode(dialog),
      dialogsAndMenus: Array.from(doc.querySelectorAll('[role="dialog"], [role="menu"], [role="tooltip"], [data-slot="tooltip-content"]'))
        .map((node) => readCloseDiagnosticNode(node)),
      activeElement: readCloseDiagnosticNode(doc.activeElement),
    });
  };
  const capture = (event: KeyboardEvent) => { if (event.key === "Escape") record("document-capture", event); };
  const bubble = (event: KeyboardEvent) => { if (event.key === "Escape") record("document-bubble", event); };
  try {
    // This observer is registered after the dialog is found; it is not the first
    // document capture listener and does not inspect Radix's private layer set.
    doc.addEventListener("keydown", capture, true);
    doc.addEventListener("keydown", bubble, false);
    record("before-dispatch");
    dispatch();
    record("after-fireEvent-return");
    return { limit, dropped, entries };
  } finally {
    doc.removeEventListener("keydown", capture, true);
    doc.removeEventListener("keydown", bubble, false);
  }
}
async function assertClosed(dialog: HTMLElement, surface: Surface, stage: CloseStage, immediate?: unknown) {
  try {
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  } catch (error) {
    // Failure-only, read-only physical DOM receipt; not an accessible-query bypass.
    const doc = dialog.ownerDocument;
    const diagnostic = JSON.stringify({
      stage,
      mode: surface.mode,
      immediate,
      dialog: readCloseDiagnosticNode(dialog),
      dialogsAndMenus: Array.from(doc.querySelectorAll('[role="dialog"], [role="menu"], [role="tooltip"], [data-slot="tooltip-content"]'))
        .map((node) => readCloseDiagnosticNode(node)),
      activeElement: readCloseDiagnosticNode(doc.activeElement),
    });
    if (error instanceof Error) {
      error.message = `R26_CLOSE_DIAGNOSTIC ${diagnostic}\n${error.message}`;
      throw error;
    }
    throw new Error(`R26_CLOSE_DIAGNOSTIC ${diagnostic}\n${String(error)}`);
  }
  await settleReactTasks();
  assertProtected(surface);
}

let initialHistory: { state: unknown; url: string };
beforeEach(async () => {
  vi.resetAllMocks();
  expectedExternalOpenCalls = 0;
  external.open.mockImplementation(async (url: string) => {
    if (url !== OFFICIAL_LEARN_MORE_URL) throw new Error("Unexpected R26 external URL");
    // Record exactly this existing browser-opener boundary; never call the
    // original implementation or permit any real browser/host/network request.
  });
  vi.spyOn(window, "open").mockImplementation(() => { throw new Error("Unexpected direct R26 window.open"); });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected R26 transport")));
  for (const method of Object.values(rpc)) method.mockRejectedValue(new Error("Unexpected R26 business RPC"));
  if (!locale.isInitialized) await locale.init({
    lng: "zh", fallbackLng: "zh", ns: ["composer"], defaultNS: "composer",
    resources: { zh: { composer: zh.composer } }, interpolation: { escapeValue: false },
  });
  initialHistory = { state: history.state, url: location.href };
  useThreadModelStore.setState({ threads: {} });
  hydrateThreadModel(A, {
    model: "r26-ordinary-a", modelProvider: "openai", reasoningEffort: "medium", serviceTier: null,
    sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user", collaborationMode: "default",
  });
  hydrateThreadModel(B, {
    model: "r26-inactive-b", modelProvider: "openai", reasoningEffort: "low", serviceTier: "priority",
    sandbox: "read-only", approvalPolicy: "untrusted", approvalsReviewer: "user", collaborationMode: "default",
  });
  useConfigStore.setState({
    model: "r26-new-default", modelProvider: "openai", providerModels: { openai: "r26-new-default" },
    reasoningEffort: "xhigh", serviceTier: null, sandbox: "danger-full-access", approvalPolicy: "never",
    approvalsReviewer: "user", collaborationMode: "default",
  });
  useCodexStore.setState({ currentThreadId: A, inputFocusTrigger: 0 });
  useLayoutStore.setState({ view: "agent" });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useSessionDraftStore.getState().setText(OWNER_A, TEXT_A);
  useSessionDraftStore.getState().setText(OWNER_B, TEXT_B);
  useSessionDraftStore.getState().setText(OWNER_DEFAULT, TEXT_DEFAULT);
});
afterEach(async () => {
  try {
    assertNoIO();
    expect(external.open).toHaveBeenCalledTimes(expectedExternalOpenCalls);
    expect(window.open).not.toHaveBeenCalled();
  }
  finally {
    cleanup();
    // Restore only this jsdom test's history state after real Sheet cleanup.
    // Its queued cleanup sees no owned marker; no Back/navigation is asserted.
    history.replaceState(initialHistory.state, "", initialHistory.url);
    await settleReactTasks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

it.each(["main", "expanded"] as const)("%s Full Access confirmation renders the ordinary native warning without changing settings", async (mode) => {
  const surface = await mountSurface(mode);
  const dialog = await openFullAccess(surface);
  try {
    const more = within(dialog).queryByRole("button", { name: "了解更多" });
    const observed = {
      title: dialog.querySelector("[data-slot=dialog-title]")?.textContent,
      capabilities: CAPABILITIES.map(({ title, description }) => ({
        title: within(dialog).queryByText(title)?.textContent ?? null,
        description: within(dialog).queryByText(description)?.textContent ?? null,
      })),
      risk: dialog.textContent?.includes("这会带来敏感数据丢失或泄露、提示注入等风险。") ?? false,
      canTurnOff: dialog.textContent?.includes("你可以将其关闭。") ?? false,
      learnMore: more?.textContent ?? null,
      learnMoreType: more?.getAttribute("type") ?? null,
      confirm: within(dialog).queryByRole("button", { name: "确认" })?.textContent ?? null,
      cancel: within(dialog).queryByRole("button", { name: "取消" })?.textContent ?? null,
      closeButtons: dialog.querySelectorAll("[data-slot=dialog-close]").length,
    };
    assertProtected(surface);
    // Only this content/markup projection is prospective RED. Ordinary source:
    // Permissions.Ht + zh-CN fullAccessConfirm entries, not a GUI pixel claim.
    expect.soft(observed).toEqual({
      title: "要开启完整访问权限吗？", capabilities: CAPABILITIES,
      risk: true, canTurnOff: true, learnMore: "了解更多", learnMoreType: "button",
      confirm: "确认", cancel: "取消", closeButtons: 0,
    });
  } finally {
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await assertClosed(dialog, surface, "content-cleanup");
  }
});

it.each(["main", "expanded"] as const)("%s cancel, reopen, Escape and pending unmount keep the captured permission request inert", async (mode) => {
  const surface = await mountSurface(mode);
  const cancelled = await openFullAccess(surface);
  fireEvent.click(within(cancelled).getByRole("button", { name: "取消" }));
  await assertClosed(cancelled, surface, "cancel");
  const escaped = await openFullAccess(surface);
  const immediate = readImmediateEscapeDiagnostic(escaped, () => {
    fireEvent.keyDown(escaped, { key: "Escape", code: "Escape" });
  });
  await assertClosed(escaped, surface, "Escape", immediate);
  const pending = await openFullAccess(surface);
  assertProtected(surface);
  surface.unmount();
  // Do not mock the original hook's resolver cleanup or resolve ask(true).
  // Remove the owned jsdom history marker before its queued navigation check.
  history.replaceState(initialHistory.state, "", initialHistory.url);
  await settleReactTasks();
  expect(pending.isConnected).toBe(false);
  assertProtected(surface, { unmounted: true });
});


it("main ordinary Learn more opens only the fixed official URL and keeps the pending confirmation inert", async () => {
  const surface = await mountSurface("main");
  const dialog = await openFullAccess(surface);
  try {
    expect(external.open).not.toHaveBeenCalled();
    const more = within(dialog).getByRole("button", { name: "了解更多" });
    expect(more.getAttribute("type")).toBe("button");
    assertProtected(surface);
    expectedExternalOpenCalls = 1;
    fireEvent.click(more);
    await waitFor(() => {
      expect(external.open).toHaveBeenCalledTimes(1);
      expect(external.open).toHaveBeenCalledWith(OFFICIAL_LEARN_MORE_URL);
    });
    await settleReactTasks();
    expect(dialog.isConnected).toBe(true);
    expect(screen.getByRole("dialog", { name: /访问权限/ })).toBe(dialog);
    expect(window.open).not.toHaveBeenCalled();
    // Opening documentation must not confirm/submit/close, modify the captured
    // A/B/default setting revisions, or clear/reassign any unsent owner draft.
    assertProtected(surface);
  } finally {
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await assertClosed(dialog, surface, "link-cleanup");
  }
});
