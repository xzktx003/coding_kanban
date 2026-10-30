import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model } from "@session/bindings/v2";
import { useModelCacheStore } from "../hooks/useModels";
import { useConfigStore } from "../stores/useConfigStore";
import { ModelReasonSelector } from "./ModelReasonSelector";
import { rememberNonFullAccessMode } from "@session/services/nonFullAccessPreference";

/**
 * The official extension refuses to silently combine `ultra` reasoning with
 * full access. `Lti` (app-initial-fee819fe4f22.js @3221724) gates the commit on
 * `!b || t !== "ultra" || s.reasoningEffort === "ultra"`, where
 * `b = f === "full-access" && (_ == null || _.startsWith(":"))`; otherwise it
 * awaits the `Pti` dialog "Use Ultra with Full access?" (@3217222) and applies
 * nothing until the user answers.
 *
 * `Pti` offers three outcomes, not two: `onContinueWithFullAccess` ("Use Full
 * access"), `onContinueWithFallback` ("Continue", `disabled: !canContinue`,
 * which sets the fallback permission mode and then applies), and `onClose`,
 * which resolves `false` and applies nothing.
 *
 * Reachability on our side: `ultra` is hidden from the native trigger
 * (`ordinaryNativePickerModels` calls `projectNativePickerEfforts` with
 * `includeUltra: false`), but the "模型与提供商设置" panel renders
 * `ReasoningEffortSelector` straight over `nativeReasoningOptions`, whose
 * allow-list contains `ultra`. So the combination is reachable in the panel,
 * and the panel is the surface that needs the gate. The existing graded
 * assertion that ultra stays hidden in the trigger must keep passing.
 *
 * Boundary: this is a local confirmation before a local write. It is not
 * native permission admission, and declining must leave the previously saved
 * effort exactly as it was rather than substituting a different one.
 */

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt/codex")>()),
  ...api,
}));

const MODEL_ID = "ultra-full-access-target";
/** Panel order comes straight from the catalog, so ultra is the last stop. */
const EFFORTS = ["low", "medium", "high", "ultra"] as const;

function catalogModel(): Model {
  return {
    id: MODEL_ID,
    model: MODEL_ID,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: "目录模型",
    description: "Synthetic complete model/list protocol fixture",
    hidden: false,
    supportedReasoningEfforts: EFFORTS.map((reasoningEffort) => ({
      reasoningEffort,
      description: `${reasoningEffort} effort`,
    })),
    defaultReasoningEffort: "medium",
    inputModalities: ["text", "image"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  } as unknown as Model;
}

/** New-chat defaults: `threadId` is null, so the panel writes useConfigStore. */
function surface() {
  return (
    <div className="session-mode">
      <ModelReasonSelector mode="panel" />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.listModels.mockResolvedValue({
    data: [catalogModel()],
    nextCursor: null,
  });
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState({
    openAiModels: [],
    otherModels: {},
    configProviders: [],
    presets: [],
    loaded: false,
    loading: false,
    error: null,
  });
  // Explicit baseline: these stores are module singletons shared across the
  // file, so nothing here may rely on a previous test's state.
  useConfigStore.setState({
    modelProvider: "openai",
    model: MODEL_ID,
    providerModels: { openai: MODEL_ID },
    reasoningEffort: "medium",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  });
});

afterEach(() => {
  localStorage.clear();
});

/** Walk the slider right to `ultra`, the ordinary keyboard route. */
async function raiseEffortToUltra() {
  const view = render(surface());
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  const slider = await screen.findByRole("slider", { name: "推理强度" });
  await waitFor(() =>
    expect(slider.getAttribute("aria-valuetext")).toBe("medium"),
  );
  // medium -> high -> ultra. The slider only moves one stop per key.
  fireEvent.keyDown(slider, { key: "ArrowRight", code: "ArrowRight" });
  await waitFor(() =>
    expect(useConfigStore.getState().reasoningEffort).toBe("high"),
  );
  fireEvent.keyDown(slider, { key: "ArrowRight", code: "ArrowRight" });
  return view;
}

it("asks before combining ultra with full access and keeps the saved effort while open", async () => {
  await raiseEffortToUltra();
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("完整访问权限");
  // Official Lti applies nothing until the dialog resolves.
  expect(useConfigStore.getState().reasoningEffort).toBe("high");
  expect(useConfigStore.getState().sandbox).toBe("danger-full-access");
});

it("applies ultra and leaves full access on when the user keeps full access", async () => {
  await raiseEffortToUltra();
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "继续使用完整访问权限" }));
  await waitFor(() =>
    expect(useConfigStore.getState().reasoningEffort).toBe("ultra"),
  );
  // Answering the question must not change the permission mode in this branch.
  expect(useConfigStore.getState().sandbox).toBe("danger-full-access");
});

it("applies ultra and steps down to the restricted mode when the user continues", async () => {
  rememberNonFullAccessMode("read-only");
  await raiseEffortToUltra();
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() =>
    expect(useConfigStore.getState().reasoningEffort).toBe("ultra"),
  );
  // Official onContinueWithFallback sets the fallback mode, then applies.
  // The paired approval policy must stay consistent with the sandbox.
  expect(useConfigStore.getState().sandbox).toBe("read-only");
  expect(useConfigStore.getState().approvalPolicy).toBe("untrusted");
});

it("has no invented restricted fallback when this host has no saved preference", async () => {
  await raiseEffortToUltra();
  await screen.findByRole("dialog");
  expect((screen.getByRole("button", { name: "继续" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/当前没有权限更受限的模式可用/)).toBeTruthy();
});

it("keeps the previously saved effort when the ultra question is dismissed", async () => {
  await raiseEffortToUltra();
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // Dismissing restores the saved value; it does not substitute another effort
  // and it does not quietly relax or tighten permissions.
  expect(useConfigStore.getState().reasoningEffort).toBe("high");
  expect(useConfigStore.getState().sandbox).toBe("danger-full-access");
  expect(useConfigStore.getState().approvalPolicy).toBe("never");
});

it("does not ask when full access is off", async () => {
  useConfigStore.setState({
    sandbox: "read-only",
    approvalPolicy: "untrusted",
  });
  await raiseEffortToUltra();
  await waitFor(() =>
    expect(useConfigStore.getState().reasoningEffort).toBe("ultra"),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useConfigStore.getState().sandbox).toBe("read-only");
});

it("does not ask when lowering the effort away from ultra", async () => {
  useConfigStore.setState({ reasoningEffort: "ultra" });
  render(surface());
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  const slider = await screen.findByRole("slider", { name: "推理强度" });
  await waitFor(() =>
    expect(slider.getAttribute("aria-valuetext")).toBe("ultra"),
  );
  // The official first arm, `t !== "ultra"`: the dialog is about entering the
  // combination, so stepping out of it must apply straight away. The separate
  // `current === "ultra"` arm cannot be reached from this slider, which never
  // emits a value equal to the one already set; it is covered directly in
  // ultraFullAccessGate.test.ts.
  fireEvent.keyDown(slider, { key: "ArrowLeft", code: "ArrowLeft" });
  await waitFor(() =>
    expect(useConfigStore.getState().reasoningEffort).toBe("high"),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useConfigStore.getState().sandbox).toBe("danger-full-access");
});
