import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createRef, type RefObject } from "react";
import * as threadModelActions from "@session/stores/useThreadModelStore";
import type { ReasoningEffort } from "@session/bindings";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { changeThreadModel, hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";
import { sessionDraftKey, useSessionDraftStore } from "@session/stores/useSessionDraftStore";
import { followupParameters } from "@session/services/followupService";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore } from "../hooks/useModels";
import { ConversationMenu } from "./ConversationMenu";
import { ComposerMenu } from "./ComposerMenu";
import { NativeModelSelector } from "./NativeModelSelector";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", async (original) => ({
  ...(await original<typeof import("@session/services/apiAdapt/codex")>()),
  ...api,
}));
vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }));
// ComposerMenu's unrelated mention discovery would read plugins/skills. The
// actual attach Popover, conversation Dropdown, goal draft, model hook and stores stay real.
vi.mock("./mentions", () => ({
  useMentionItems: () => ({ items: [] }),
  mentionsWithIcon: (items: unknown[]) => items,
}));

const A = "r22-command-owner-a", B = "r22-command-owner-b";
const UNKNOWN = "r22-unknown-model", OWNER = sessionDraftKey("codex", A);
const DRAFT = "R22 保留原草稿";
const COMMANDS = ["提高推理强度", "降低推理强度", "循环切换推理强度"] as const;

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function model(efforts: ReasoningEffort[]): Model {
  return {
    id: "r22-known-model", model: "r22-known-model", displayName: "R22 已知模型",
    description: "synthetic model/list fixture", hidden: false, isDefault: true,
    upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium", inputModalities: ["text"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
  };
}
type MenuPlacement = "direct" | "portal" | "portal-missing-ref" | "portal-null-ref" | "direct-null-ref";
function prepare(effort: ReasoningEffort | null, selectedModel = UNKNOWN, provider = "openai", placement: MenuPlacement = "direct") {
  hydrateThreadModel(A, { model: selectedModel, modelProvider: provider, reasoningEffort: effort, serviceTier: null });
  if (!selectedModel) changeThreadModel(A, { model: selectedModel, modelProvider: provider, reasoningEffort: effort, serviceTier: null });
  hydrateThreadModel(B, { model: "r22-unrelated-model", modelProvider: "openai", reasoningEffort: "persistent", serviceTier: null });
  useSessionDraftStore.getState().setText(OWNER, DRAFT);
  const before = {
    a: useThreadModelStore.getState().threads[A], b: useThreadModelStore.getState().threads[B],
    defaults: useConfigStore.getState(), draft: useSessionDraftStore.getState().drafts[OWNER],
  };
  const submit = vi.fn();
  const formRef = createRef<HTMLFormElement>();
  const originRef: RefObject<HTMLElement | null> = placement.endsWith("null-ref")
    ? createRef<HTMLElement>() : formRef;
  const portal = placement.startsWith("portal");
  const menuProps = {
    threadId: A, draftOwner: OWNER, title: "R22 当前会话",
    ...(placement === "portal" || placement.endsWith("null-ref") ? { composerRef: originRef } : {}),
  };
  const surface = render(<div className="session-mode">
    <section className="session-codex-composer" data-draft-owner={OWNER} data-owner-thread={A}>
      <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="session-rich-draft"><textarea aria-label="R22 保留草稿" defaultValue={DRAFT} /></div>
        <NativeModelSelector threadId={A} draftOwner={OWNER} />
        {portal
          ? <ComposerMenu owner={OWNER} actions={() => <ConversationMenu {...menuProps} variant="item" />} />
          : <ConversationMenu {...menuProps} />}
      </form>
    </section>
  </div>);
  return { ...surface, before, submit, formRef, originRef };
}
function assertUnrelated(surface: ReturnType<typeof prepare>, response?: ModelListResponse) {
  const current = useThreadModelStore.getState().threads[A];
  expect(current.model).toBe(surface.before.a.model);
  expect(current.modelProvider).toBe(surface.before.a.modelProvider);
  expect(current.serviceTier).toBe(surface.before.a.serviceTier);
  expect(current.sandbox).toBe(surface.before.a.sandbox);
  expect(current.approvalPolicy).toBe(surface.before.a.approvalPolicy);
  expect(useThreadModelStore.getState().threads[B]).toBe(surface.before.b);
  expect(useConfigStore.getState()).toBe(surface.before.defaults);
  expect(useSessionDraftStore.getState().drafts[OWNER]).toBe(surface.before.draft);
  expect((screen.getByLabelText("R22 保留草稿") as HTMLTextAreaElement).value).toBe(DRAFT);
  expect(surface.submit).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  if (response) {
    expect(useModelCacheStore.getState().openAiModels).toBe(response.data);
    response.data.forEach((item, index) => {
      expect(useModelCacheStore.getState().openAiModels[index]).toBe(item);
      expect(useModelCacheStore.getState().openAiModels[index].supportedReasoningEfforts).toBe(item.supportedReasoningEfforts);
    });
  }
}
async function settled(response: ModelListResponse) {
  await waitFor(() => expect(useModelCacheStore.getState().loading).toBe(false));
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
  expect(useModelCacheStore.getState().openAiModels).toBe(response.data);
}
async function command(label: typeof COMMANDS[number]) {
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), { key: "ArrowDown" });
  return await screen.findByRole("menuitem", { name: label });
}

beforeEach(() => {
  // Explicit initial enabled membership preserves the original none/minimal/max
  // counterexamples. The app display policy still excludes ultra.
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts([
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent",
  ]);
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected R22 transport")));
  api.listModels.mockResolvedValue({ data: [], nextCursor: null });
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  // Start from the real cache's initial state, including future provenance fields.
  useModelCacheStore.setState(useModelCacheStore.getInitialState(), true);
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({ model: "r22-default-model", modelProvider: "openai", providerModels: { openai: "r22-default-model" }, reasoningEffort: "high", serviceTier: null });
  useCodexStore.setState({ currentThreadId: A });
  useLayoutStore.setState({ view: "agent" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useWorkspaceStore.setState({ cwd: "/fixture/r22" });
});
afterEach(() => {
  try { expect(globalThis.fetch).not.toHaveBeenCalled(); }
  finally { cleanup(); vi.unstubAllGlobals(); }
});

it.each((["medium", "none", null] as const).flatMap((raw) => COMMANDS.map((label, index) => ({ raw, label, expected: ["high", "low", "high"][index] }))))("uses native bt for unknown raw $raw with $label", async ({ raw, label, expected }) => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(raw);
  await settled(response);
  expect(useModelCacheStore.getState().loaded).toBe(true);
  expect(useModelCacheStore.getState().error).toBeNull();
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  fireEvent.click(await command(label));
  assertUnrelated(surface, response);
  expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe(expected);
  expect.soft(followupParameters(A).effort).toBe(expected);
});

it.each([
  ["low", "降低推理强度", "minimal"],
  ["xhigh", "提高推理强度", "max"],
  ["max", "循环切换推理强度", "minimal"],
  ["persistent", "循环切换推理强度", "high"],
  ["ultra", "降低推理强度", "low"],
] as const)("steps unknown %s with %s to %s", async (raw, label, expected) => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(raw);
  await settled(response);
  fireEvent.click(await command(label));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe(expected);
  expect(followupParameters(A).effort).toBe(expected);
});

it.each([["minimal", "降低推理强度"], ["max", "提高推理强度"]] as const)("does not repair unknown %s at the clamped boundary", async (raw, label) => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(raw);
  await settled(response);
  fireEvent.click(await command(label));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

it.each(COMMANDS)("explicit %s selects the sole known none from native raw null", async (label) => {
  const response: ModelListResponse = { data: [model(["none"])], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(null, response.data[0].id);
  await settled(response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  fireEvent.click(await command(label));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("none");
});

it.each(([[], ["medium"], ["persistent"]] as ReasoningEffort[][]).map((efforts) => ({ efforts })))("does not write for known non-changing candidates $efforts and raw null", async ({ efforts }) => {
  const response: ModelListResponse = { data: [model(efforts)], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(null, response.data[0].id);
  await settled(response);
  for (const label of COMMANDS) fireEvent.click(await command(label));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

it("publishes successful model/list and enables commands before the three ancillary reads settle", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  const providers = deferred<[]>(), other = deferred<[]>(), presets = deferred<[]>();
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockReturnValue(providers.promise);
  api.listOtherModels.mockReturnValue(other.promise);
  api.listProviderPresets.mockReturnValue(presets.promise);
  const surface = prepare("medium");
  try {
    await act(async () => { await Promise.resolve(); });
    for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
    expect(useModelCacheStore.getState().loading).toBe(true);
    expect(useModelCacheStore.getState().loaded).toBe(false);
    const item = await command("提高推理强度");
    fireEvent.click(item);
    assertUnrelated(surface);
    expect.soft(useModelCacheStore.getState().openAiModels).toBe(response.data);
    expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  } finally {
    await act(async () => { providers.resolve([]); other.resolve([]); presets.resolve([]); });
  }
});

it("permits an unknown command when model/list succeeds but provider/preset reads fail", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockRejectedValue(new Error("fixture providers unavailable"));
  api.listProviderPresets.mockRejectedValue(new Error("fixture presets unavailable"));
  const surface = prepare("none");
  await settled(response);
  expect(useModelCacheStore.getState().loaded).toBe(false);
  expect(useModelCacheStore.getState().error).toContain("fixture providers unavailable");
  fireEvent.click(await command("降低推理强度"));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("low");
});

it("disables all commands while the initial model/list read is pending", async () => {
  const pending = deferred<ModelListResponse>();
  api.listModels.mockReturnValue(pending.promise);
  const surface = prepare("medium");
  try {
    for (const label of COMMANDS) {
      const item = await command(label);
      expect.soft(item.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(item);
      fireEvent.keyDown(item, { key: "Escape" });
    }
    assertUnrelated(surface);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  } finally { await act(async () => pending.resolve({ data: [], nextCursor: null })); }
});

it("permits a command after a first model/list error without a snapshot", async () => {
  api.listModels.mockRejectedValue(new Error("fixture first model error"));
  const surface = prepare(null);
  await waitFor(() => expect(useModelCacheStore.getState().error).toContain("fixture first model error"));
  expect(useModelCacheStore.getState().loaded).toBe(false);
  expect(useModelCacheStore.getState().openAiModels).toEqual([]);
  fireEvent.click(await command("提高推理强度"));
  assertUnrelated(surface);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
});

it("keeps retained unknown commands usable during background fetching and after its model error", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValueOnce(response);
  const surface = prepare("medium");
  await settled(response);
  const retry = deferred<ModelListResponse>();
  api.listModels.mockReturnValueOnce(retry.promise);
  let loading!: Promise<void>;
  act(() => { useModelCacheStore.setState({ loaded: false }); loading = useModelCacheStore.getState().load(); });
  try {
    expect(useModelCacheStore.getState().loading).toBe(true);
    fireEvent.click(await command("提高推理强度"));
    expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  } finally {
    await act(async () => { retry.reject(new Error("fixture retained model error")); await loading; });
  }
  expect(useModelCacheStore.getState().error).toContain("fixture retained model error");
  fireEvent.click(await command("降低推理强度"));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("medium");
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(2);
});

it.each(["other-thread", "wrong-owner", "hidden", "secondary-page", "acp"] as const)("does not dispatch to an inactive composer: %s", async (inactive) => {
  const response: ModelListResponse = { data: [model(["low", "medium", "high"])], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare("medium", response.data[0].id);
  await settled(response);
  const item = await command("提高推理强度");
  act(() => {
    if (inactive === "other-thread") useCodexStore.setState({ currentThreadId: B });
    if (inactive === "wrong-owner") surface.container.querySelector<HTMLElement>("section")!.dataset.draftOwner = "codex:r22-other";
    if (inactive === "hidden") surface.container.querySelector<HTMLElement>(".session-mode")!.hidden = true;
    if (inactive === "secondary-page") useLayoutStore.setState({ view: "settings" });
    if (inactive === "acp") useAcpStore.setState({ active: true });
  });
  fireEvent.click(item);
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

it.each([[UNKNOWN, "custom"], ["", "openai"]] as const)("does not invent unknown command choices for model %s provider %s", async (selected, provider) => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare("none", selected, provider);
  await settled(response);
  for (const label of COMMANDS) fireEvent.click(await command(label));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

function modelTrigger() {
  return document.querySelector<HTMLButtonElement>(".session-native-model-trigger")!;
}
async function modelMenu() {
  fireEvent.keyDown(modelTrigger(), { key: "ArrowDown", code: "ArrowDown" });
  return await screen.findByRole("menu");
}

it("shows loading rather than a usable unknown picker before initial model/list settles", async () => {
  const pending = deferred<ModelListResponse>();
  api.listModels.mockReturnValue(pending.promise);
  const surface = prepare("none");
  try {
    expect.soft(modelTrigger().textContent).toMatch(/Loading model/);
    expect.soft(modelTrigger().disabled).toBe(true);
    fireEvent.keyDown(modelTrigger(), { key: "ArrowDown" });
    expect.soft(screen.queryByRole("menu")).toBeNull();
    assertUnrelated(surface);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  } finally { await act(async () => pending.resolve({ data: [], nextCursor: null })); }
});

it("uses legacy advanced with zero power entries after model/list error without any snapshot", async () => {
  api.listModels.mockRejectedValue(new Error("fixture no model snapshot"));
  const surface = prepare("none");
  await waitFor(() => expect(useModelCacheStore.getState().error).toContain("fixture no model snapshot"));
  expect.soft(modelTrigger().querySelector(".session-native-model-label")?.textContent).toBe("自定义");
  expect.soft(modelTrigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
  const menu = await modelMenu();
  expect.soft(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("advanced");
  expect.soft(menu.querySelector("[data-reasoning-slider]")).toBeNull();
  expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(0);
  assertUnrelated(surface);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

it("renders six usable unknown powers once model/list succeeds while ancillary requests are still pending", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  const providers = deferred<[]>(), other = deferred<[]>(), presets = deferred<[]>();
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockReturnValue(providers.promise);
  api.listOtherModels.mockReturnValue(other.promise);
  api.listProviderPresets.mockReturnValue(presets.promise);
  const surface = prepare("none");
  try {
    await act(async () => { await Promise.resolve(); });
    expect(useModelCacheStore.getState().loading).toBe(true);
    const ownedTrigger = modelTrigger();
    const menu = await modelMenu();
    expect.soft(ownedTrigger.querySelector(".session-native-model-label")).toBeNull();
    expect.soft(ownedTrigger.querySelector(".session-native-model-effort")).toBeNull();
    expect.soft(ownedTrigger.getAttribute("aria-label")).toBeNull();
    expect.soft(ownedTrigger.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null).toBe("选择强度");
    expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
    expect.soft(menu.querySelector('[role="status"]')?.textContent).toContain("第 3 项，共 6 项");
    assertUnrelated(surface);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  } finally {
    await act(async () => { providers.resolve([]); other.resolve([]); presets.resolve([]); });
  }
});

it("retains six unknown powers and disables model rows after a retained model/list error", async () => {
  const response: ModelListResponse = { data: [model(["low", "medium", "high"])], nextCursor: null };
  api.listModels.mockResolvedValueOnce(response);
  const surface = prepare("none");
  await settled(response);
  api.listModels.mockRejectedValueOnce(new Error("fixture retained snapshot error"));
  await act(async () => { useModelCacheStore.setState({ loaded: false }); await useModelCacheStore.getState().load(); });
  expect(useModelCacheStore.getState().error).toContain("fixture retained snapshot error");
  expect.soft(modelTrigger().querySelector(".session-native-model-label")?.textContent).toBe("自定义");
  expect.soft(modelTrigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
  const editor = screen.getByRole("textbox", { name: "R22 保留草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  const menu = await modelMenu();
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  const slider = menu.querySelector<HTMLElement>("[data-reasoning-slider]")!;
  expect.soft(menu.querySelector('[role="status"]')?.textContent).toContain("第 3 项，共 6 项");
  fireEvent.keyDown(slider, { key: "ArrowRight", code: "ArrowRight" });
  expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  const caption = screen.getByRole("menuitem", { name: "选择模型" });
  fireEvent.pointerDown(caption, { pointerType: "mouse", button: 0 });
  fireEvent.click(caption);
  const row = await screen.findByRole("menuitemradio", { name: "R22 已知模型" });
  expect.soft(row.getAttribute("aria-disabled")).toBe("true");
  const beforeRow = useThreadModelStore.getState().threads[A];
  fireEvent.click(row);
  expect.soft(useThreadModelStore.getState().threads[A]).toBe(beforeRow);
  assertUnrelated(surface, response);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(2);
});

it("does not turn a background fetch or a warm provider-only error into initial model loading", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValueOnce(response);
  const surface = prepare("none");
  await settled(response);
  const pending = deferred<ModelListResponse>();
  api.listModels.mockReturnValueOnce(pending.promise);
  let loading!: Promise<void>;
  act(() => { useModelCacheStore.setState({ loaded: false }); loading = useModelCacheStore.getState().load(); });
  try {
    expect(useModelCacheStore.getState().loading).toBe(true);
    expect.soft(modelTrigger().textContent).not.toMatch(/Loading model/);
    expect.soft(modelTrigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
    expect.soft((await modelMenu()).querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  } finally { await act(async () => { pending.resolve(response); await loading; }); }
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  api.listConfigProviders.mockRejectedValueOnce(new Error("fixture warm provider error"));
  await act(async () => useModelCacheStore.getState().refreshProviders());
  expect(useModelCacheStore.getState().loaded).toBe(true);
  expect(useModelCacheStore.getState().error).toContain("fixture warm provider error");
  expect.soft(modelTrigger().querySelector(".session-native-model-label")?.textContent).toBe("自定义");
  expect.soft(modelTrigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
  expect.soft((await modelMenu()).querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(api.listModels).toHaveBeenCalledTimes(2);
  expect(api.listConfigProviders).toHaveBeenCalledTimes(3);
});

it("does not treat an id-only alias as a known canonical model for a reasoning command", async () => {
  const advertised = { ...model(["low", "medium"]), id: "r22-id-only-alias", model: "r22-different-canonical-model" };
  const response: ModelListResponse = { data: [advertised], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare("xhigh", advertised.id);
  await settled(response);
  fireEvent.click(await command("提高推理强度"));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("max");
  expect(followupParameters(A).model).toBe(advertised.id);
});

it.each(["hidden", "inert"] as const)("rejects an already-portalled command after its own composer becomes %s", async (attribute) => {
  const response: ModelListResponse = { data: [model(["low", "medium", "high"])], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare("medium", response.data[0].model);
  await settled(response);
  const item = await command("提高推理强度");
  surface.container.querySelector("section")!.setAttribute(attribute, "");
  expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(surface.container.querySelector<HTMLElement>(".session-mode")!.hidden).toBe(false);
  fireEvent.click(item);
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

it.each([
  { scenario: "wrong actual owner without a passed owner", className: "session-codex-composer", owner: "codex:r22-wrong" },
  { scenario: "no composer ancestor", className: "r22-non-composer", owner: OWNER },
  { scenario: "matching visible actual owner", className: "session-codex-composer", owner: OWNER },
])("requires a visible matching main owner in the workbench: $scenario", async ({ scenario, className, owner }) => {
  const response: ModelListResponse = { data: [model(["low", "medium", "high"])], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare("medium", response.data[0].model);
  await settled(response);
  surface.unmount();
  render(<div className="session-mode"><section className={className} data-draft-owner={owner}>
    <textarea aria-label="R22 保留草稿" defaultValue={DRAFT} />
    <ConversationMenu threadId={A} title="R22 main owner proof" />
  </section></div>);
  fireEvent.click(await command("提高推理强度"));
  assertUnrelated(surface, response);
  if (scenario === "matching visible actual owner")
    expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  else expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

it.each([null, undefined])("settles a fulfilled whole model DTO %s as error instead of permanent pending", async (invalid) => {
  api.listModels.mockResolvedValue(invalid);
  const surface = prepare("none");
  await waitFor(() => expect(useModelCacheStore.getState().loading).toBe(false));
  expect(useModelCacheStore.getState().error).toBeTruthy();
  expect(useModelCacheStore.getState().loaded).toBe(false);
  expect.soft(useModelCacheStore.getState().modelStatus).toBe("error");
  expect.soft(modelTrigger().textContent).not.toMatch(/Loading model/);
  fireEvent.click(await command("提高推理强度"));
  assertUnrelated(surface);
  expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
});

it("keeps pending commands disabled for an injected catalog array with no accepted snapshot", async () => {
  // No production writer was found for this state. This is an explicit cache
  // boundary control, not evidence that model/list naturally publishes it.
  const pending = deferred<ModelListResponse>();
  const advertised = model(["low", "medium", "high"]);
  useModelCacheStore.setState({ openAiModels: [advertised] });
  api.listModels.mockReturnValue(pending.promise);
  const surface = prepare("medium", advertised.model);
  try {
    expect(useModelCacheStore.getState().modelStatus).toBe("pending");
    const item = await command("提高推理强度");
    expect.soft(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    assertUnrelated(surface);
    expect.soft(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  } finally { await act(async () => pending.resolve({ data: [advertised], nextCursor: null })); }
});

it.each([null, undefined])("retains a snapshot but disables model selection after a fulfilled retained whole model DTO %s", async (invalid) => {
  const response: ModelListResponse = { data: [model(["low", "medium", "high"])], nextCursor: null };
  api.listModels.mockResolvedValueOnce(response);
  const surface = prepare("none");
  await settled(response);
  api.listModels.mockResolvedValueOnce(invalid);
  await act(async () => { useModelCacheStore.setState({ loaded: false }); await useModelCacheStore.getState().load(); });
  expect(useModelCacheStore.getState().loading).toBe(false);
  expect(useModelCacheStore.getState().loaded).toBe(false);
  expect(useModelCacheStore.getState().error).toBeTruthy();
  expect.soft(useModelCacheStore.getState().modelStatus).toBe("error");
  const menu = await modelMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  const caption = screen.getByRole("menuitem", { name: "选择模型" });
  fireEvent.pointerDown(caption, { pointerType: "mouse", button: 0 });
  fireEvent.click(caption);
  const row = await screen.findByRole("menuitemradio", { name: "R22 已知模型" });
  expect.soft(row.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(row);
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});

it("uses the exact original Loading model message and busy state while model/list is initially pending", async () => {
  const pending = deferred<ModelListResponse>();
  api.listModels.mockReturnValue(pending.promise);
  const surface = prepare("none");
  try {
    expect.soft(modelTrigger().querySelector(".session-native-model-label")?.textContent).toBe("Loading model…");
    expect.soft(modelTrigger().getAttribute("aria-busy")).toBe("true");
    expect(modelTrigger().disabled).toBe(true);
    assertUnrelated(surface);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  } finally { await act(async () => pending.resolve({ data: [], nextCursor: null })); }
});

it.each(["model-error", "ancillary-error", "custom-error"] as const)("keeps only the custom extension's inline retry/error bar: %s", async (failure) => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  if (failure === "model-error") api.listModels.mockRejectedValue(new Error("fixture native model error bar"));
  else api.listOtherModels.mockRejectedValue(new Error("fixture ancillary error bar"));
  const surface = prepare("none", UNKNOWN, failure === "custom-error" ? "fixture-custom" : "openai");
  await waitFor(() => expect(useModelCacheStore.getState().error).toBeTruthy());
  const menu = await modelMenu();
  const caption = screen.queryByRole("menuitem", { name: "选择模型" });
  if (caption) {
    fireEvent.pointerDown(caption, { pointerType: "mouse", button: 0 });
    fireEvent.click(caption);
  }
  if (failure === "custom-error") {
    expect(menu.querySelector('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  } else {
    expect.soft(menu.querySelector('[role="alert"]')).toBeNull();
    expect.soft(screen.queryByRole("button", { name: "重试" })).toBeNull();
  }
  assertUnrelated(surface, failure === "model-error" ? undefined : response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
});

it.each(["low", "none"] as const)("displays native medium for an existing null-effort thread despite known default %s", async (defaultEffort) => {
  const advertised = { ...model([defaultEffort, "medium", "high"]), defaultReasoningEffort: defaultEffort };
  const response: ModelListResponse = { data: [advertised], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(null, advertised.model);
  await settled(response);
  expect(surface.before.a.reasoningEffort).toBeNull();
  expect(surface.before.defaults.reasoningEffort).toBe("high");
  expect.soft(modelTrigger().getAttribute("aria-label")).toBe(`模型：${advertised.model}，medium`);
  expect.soft(modelTrigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
  const menu = await modelMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(3);
  expect.soft(menu.querySelector(".session-native-power-effort")?.textContent).toBe("中");
  expect.soft(menu.querySelector('[role="status"]')?.textContent).toContain("第 2 项，共 3 项");
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
});

it.each([false, true])("disables all model radios after a model error, retained snapshot=%s", async (retained) => {
  const response: ModelListResponse = { data: [model(["low", "medium", "high"])], nextCursor: null };
  if (retained) api.listModels.mockResolvedValueOnce(response);
  else api.listModels.mockRejectedValueOnce(new Error("fixture all-row initial error"));
  const surface = prepare("none");
  if (retained) {
    await settled(response);
    api.listModels.mockRejectedValueOnce(new Error("fixture all-row retained error"));
    await act(async () => { useModelCacheStore.setState({ loaded: false }); await useModelCacheStore.getState().load(); });
  } else await waitFor(() => expect(useModelCacheStore.getState().error).toBeTruthy());
  const menu = await modelMenu();
  const caption = screen.queryByRole("menuitem", { name: "选择模型" });
  if (caption) { fireEvent.pointerDown(caption, { pointerType: "mouse", button: 0 }); fireEvent.click(caption); }
  const rows = screen.getAllByRole("menuitemradio");
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect.soft(row.getAttribute("aria-disabled")).toBe("true");
  assertUnrelated(surface, retained ? response : undefined);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(menu.querySelector('[data-model-picker-view="advanced"]')).not.toBeNull();
});

it("preserves the existing custom-provider raw stepping when its ID also occurs in the OpenAI catalog", async () => {
  // Local compatibility only: this is not an original standalone custom-sheet oracle.
  const advertised = model(["low", "medium", "high"]);
  const response: ModelListResponse = { data: [advertised], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockResolvedValue([{ name: "fixture-custom", base_url: "https://unused.invalid" }]);
  api.listOtherModels.mockResolvedValue([{ provider: "fixture-custom", models: [{ id: advertised.model }] }]);
  const surface = prepare("none", advertised.model, "fixture-custom");
  await settled(response);
  fireEvent.click(await command("提高推理强度"));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("low");
});

it("preserves the local custom command's original id-or-model lookup", async () => {
  const advertised = { ...model(["low", "medium", "high"]), id: "r22-custom-id-alias", model: "r22-unrelated-canonical-model" };
  const response: ModelListResponse = { data: [advertised], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare("none", advertised.id, "fixture-custom");
  await settled(response);
  fireEvent.click(await command("提高推理强度"));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("low");
});

it("keeps local custom commands enabled but unwritten during the initial OpenAI model read", async () => {
  const pending = deferred<ModelListResponse>();
  api.listModels.mockReturnValue(pending.promise);
  const surface = prepare("none", UNKNOWN, "fixture-custom");
  try {
    expect(useModelCacheStore.getState().loading).toBe(true);
    const item = await command("提高推理强度");
    expect.soft(item.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(item);
    assertUnrelated(surface);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  } finally { await act(async () => pending.resolve({ data: [], nextCursor: null })); }
});

it.each([
  { efforts: ["low"] as ReasoningEffort[] },
  { efforts: ["none"] as ReasoningEffort[] },
  { efforts: ["ultra"] as ReasoningEffort[] },
  { efforts: ["low", "high"] as ReasoningEffort[] },
])("keeps the closed medium label for an existing raw-null thread with known $efforts", async ({ efforts }) => {
  const advertised = { ...model(efforts), defaultReasoningEffort: efforts[0] };
  const response: ModelListResponse = { data: [advertised], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(null, advertised.model);
  await settled(response);
  expect(surface.before.a.reasoningEffort).toBeNull();
  expect.soft(modelTrigger().getAttribute("aria-label")).toBe(`模型：${advertised.model}，medium`);
  expect.soft(modelTrigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
  // Only the closed trigger is asserted. A menu without medium has a separate
  // native TX fallback and is not inferred from this closed-label oracle.
});

it.each([
  { name: "selected-default-low", selectedModel: "r22-tx-known", selectedDefault: "low", isDefault: true, otherDefault: null, raw: null, expected: "low" },
  { name: "selected-default-high", selectedModel: "r22-tx-known", selectedDefault: "high", isDefault: true, otherDefault: null, raw: null, expected: "high" },
  { name: "nondefault-prefers-first-over-current-default", selectedModel: "r22-tx-known", selectedDefault: "high", isDefault: false, otherDefault: "medium", raw: null, expected: "low" },
  { name: "sol-reuses-other-default-effort", selectedModel: "gpt-5.6-sol", selectedDefault: "low", isDefault: false, otherDefault: "high", raw: null, expected: "high" },
  { name: "invalid-persistent-has-the-same-bt-fallback", selectedModel: "r22-tx-known", selectedDefault: "high", isDefault: false, otherDefault: "medium", raw: "persistent", expected: "low" },
  { name: "unsupported-ultra-uses-sol-fallback", selectedModel: "gpt-5.6-sol", selectedDefault: "low", isDefault: false, otherDefault: "high", raw: "ultra", expected: "high" },
  { name: "supported-high-precedes-preferred-fallback", selectedModel: "r22-tx-known", selectedDefault: "low", isDefault: true, otherDefault: null, raw: "high", expected: "high" },
  { name: "supported-sol-low-precedes-other-default", selectedModel: "gpt-5.6-sol", selectedDefault: "high", isDefault: false, otherDefault: "high", raw: "low", expected: "low" },
] as const)("derives the ordinary current-model menu TX power: $name", async ({ selectedModel, selectedDefault, isDefault, otherDefault, raw, expected }) => {
  const selected = {
    ...model(["low", "high"]), id: selectedModel, model: selectedModel,
    defaultReasoningEffort: selectedDefault, isDefault,
  };
  const other = {
    ...model(["medium", "high"]), id: "r22-tx-default-other", model: "r22-tx-default-other",
    defaultReasoningEffort: otherDefault ?? "medium", isDefault: true,
  };
  const response: ModelListResponse = { data: otherDefault ? [other, selected] : [selected], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(raw, selectedModel);
  await settled(response);
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(modelTrigger().querySelector(".session-native-model-effort")?.textContent).toBe(raw === "low" ? "轻度" : raw === "high" ? "高" : "中");
  const menu = await modelMenu();
  expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull();
  const expectedLabel = expected === "low" ? "轻度" : "高";
  const position = expected === "low" ? 1 : 2;
  expect.soft(menu.querySelector(".session-native-power-effort")?.textContent).toBe(expectedLabel);
  expect.soft(menu.querySelector('[role="status"]')?.textContent).toContain(`${expected === "high" ? "深度" : expectedLabel}，第 ${position} 项，共 2 项`);
  const thumb = menu.querySelector<HTMLElement>(".session-native-power-thumb");
  expect.soft(thumb?.style.left).toMatch(position === 1
    ? /^calc\((?:13px|13px \+ 0px)\)$/
    : /^calc\((?:187px|13px \+ 174px)\)$/);
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(followupParameters(A).effort).toBe(raw);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
});

it.each([
  { raw: "high", label: "提高推理强度", notice: "推理强度已是最高" },
  { raw: "low", label: "降低推理强度", notice: "推理强度已是最低" },
] as const)("preserves the local custom boundary no-op: $label", async ({ raw, label, notice }) => {
  const advertised = model(["low", "medium", "high"]);
  const response: ModelListResponse = { data: [advertised], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(raw, advertised.model, "fixture-custom");
  await settled(response);
  const change = vi.spyOn(threadModelActions, "changeThreadModel");
  try {
    fireEvent.click(await command(label));
    assertUnrelated(surface, response);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
    expect.soft(change).not.toHaveBeenCalled();
    expect.soft(toast.message).toHaveBeenCalledExactlyOnceWith(notice);
  } finally { change.mockRestore(); }
});

it("uses the original Loading model aria name while the first native model read is pending", async () => {
  const pending = deferred<ModelListResponse>();
  api.listModels.mockReturnValue(pending.promise);
  const surface = prepare("none");
  try {
    expect(useModelCacheStore.getState().modelStatus).toBe("pending");
    expect(modelTrigger().disabled).toBe(true);
    expect(modelTrigger().getAttribute("aria-busy")).toBe("true");
    expect(modelTrigger().querySelector(".session-native-model-label")?.textContent).toBe("Loading model…");
    expect.soft(modelTrigger().getAttribute("aria-label")).toBe("Loading model…");
    assertUnrelated(surface);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  } finally { await act(async () => pending.resolve({ data: [], nextCursor: null })); }
  await waitFor(() => expect(useModelCacheStore.getState().modelStatus).toBe("success"));
  expect(modelTrigger().getAttribute("aria-busy")).toBeNull();
});

async function portalCommand(label: typeof COMMANDS[number]) {
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  const trigger = await screen.findByRole("button", { name: "当前会话的更多操作" });
  expect(trigger.closest('[data-slot="popover-content"]')).not.toBeNull();
  expect(trigger.closest(".session-codex-composer")).toBeNull();
  expect(trigger.closest(".session-mode")).toBe(document.querySelector(".session-mode"));
  fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  const item = await screen.findByRole("menuitem", { name: label });
  expect(item.closest('[data-slot="dropdown-menu-content"]')).not.toBeNull();
  expect(item.getAttribute("aria-disabled")).not.toBe("true");
  expect(item.isConnected).toBe(true);
  return item;
}

it.each([
  { raw: "none", label: "提高推理强度", activation: "pointer", expected: "high", singleton: false },
  { raw: null, label: "降低推理强度", activation: "Enter", expected: "low", singleton: false },
  { raw: "max", label: "循环切换推理强度", activation: "Space", expected: "minimal", singleton: false },
  { raw: null, label: "提高推理强度", activation: "pointer", expected: "none", singleton: true },
] as const)("dispatches the real nested-portal command $label via $activation, singleton=$singleton", async ({ raw, label, activation, expected, singleton }) => {
  const advertised = model(["none"]);
  const response: ModelListResponse = { data: singleton ? [advertised] : [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare(raw, singleton ? advertised.model : UNKNOWN, "openai", "portal");
  await settled(response);
  expect(surface.originRef.current).toBe(surface.formRef.current);
  expect(surface.formRef.current?.closest(".session-codex-composer")?.getAttribute("data-draft-owner")).toBe(OWNER);
  const item = await portalCommand(label);
  if (activation === "pointer") fireEvent.click(item);
  else fireEvent.keyDown(item, { key: activation === "Space" ? " " : "Enter", code: activation });
  assertUnrelated(surface, response);
  expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe(expected);
  expect.soft(followupParameters(A).effort).toBe(expected);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
});

it.each([
  "missing-ref", "null-ref", "ref-cleared", "disconnected", "wrong-owner",
  "hidden", "inert", "thread-mismatch", "agent-mismatch", "acp-active", "foreign-session-root", "missing-session-root",
] as const)("rejects a stale real nested-portal origin: %s", async (condition) => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const placement = condition === "missing-ref" ? "portal-missing-ref" : condition === "null-ref" ? "portal-null-ref" : "portal";
  const surface = prepare("none", UNKNOWN, "openai", placement);
  await settled(response);
  const item = await portalCommand("提高推理强度");
  const scope = surface.container.querySelector<HTMLElement>(".session-codex-composer")!;
  const form = surface.formRef.current!;
  let restore = () => {};
  try {
    if (condition === "ref-cleared") surface.originRef.current = null;
    if (condition === "disconnected") {
      const parent = form.parentNode!, next = form.nextSibling;
      form.remove();
      restore = () => parent.insertBefore(form, next);
    }
    if (condition === "wrong-owner") scope.dataset.draftOwner = sessionDraftKey("codex", B);
    if (condition === "hidden") scope.hidden = true;
    if (condition === "inert") scope.setAttribute("inert", "");
    if (condition === "missing-session-root") {
      const root = scope.closest(".session-mode")!;
      root.classList.remove("session-mode");
      restore = () => root.classList.add("session-mode");
    }
    if (condition === "thread-mismatch") await act(async () => useCodexStore.setState({ currentThreadId: B }));
    if (condition === "agent-mismatch") await act(async () => useAgentSettingsStore.setState({ selectedAgent: "cc" }));
    if (condition === "acp-active") await act(async () => useAcpStore.setState({ active: true }));
    if (condition === "foreign-session-root") {
      const root = document.createElement("div");
      root.className = "session-mode";
      const foreign = document.createElement("section");
      foreign.className = "session-codex-composer";
      foreign.dataset.draftOwner = OWNER;
      const otherForm = document.createElement("form");
      foreign.append(otherForm); root.append(foreign); document.body.append(root);
      surface.originRef.current = otherForm;
      restore = () => root.remove();
    }
    fireEvent.click(item);
    // The action ran with a detached origin. Restore only afterward so the
    // shared draft-preservation assertion can inspect the original textarea.
    restore(); restore = () => {};
    assertUnrelated(surface, response);
    expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
    expect(followupParameters(A).effort).toBe("none");
    for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
  } finally { restore(); }
});

it("does not fall back to a valid direct ancestor when an explicit origin ref is null", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const surface = prepare("none", UNKNOWN, "openai", "direct-null-ref");
  await settled(response);
  expect(surface.originRef.current).toBeNull();
  expect(screen.getByRole("button", { name: "当前会话的更多操作" }).closest(".session-codex-composer")).not.toBeNull();
  fireEvent.click(await command("提高推理强度"));
  assertUnrelated(surface, response);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
});
