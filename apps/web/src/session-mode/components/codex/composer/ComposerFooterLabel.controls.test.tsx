import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccessModePopover } from "./AccessModePopover";
import { NativeModelTrigger } from "./NativeModelTrigger";
import { ComposerToolbarProvider } from "./ComposerToolbarContext";

/**
 * Per-control tiers, read off the shipped 26.51007.21434 webview:
 *
 * - Permissions: `collapse: "xs"` — hidden at <=300px.
 *   `permissions-mode-dropdown-6fd05cb80d75.js` exports `PermissionsModeDropdown`
 *   as `vn`, which picks between three trigger implementations. The `account`
 *   branch is unreachable here: that context value is only supplied when
 *   `useAsbDirect === true` (`app-initial-fee819fe4f22.js` @5707078) and is
 *   `null` otherwise. The remaining choice is the `permissionRefresh` remote
 *   flag `4226282475` (@754510): off → `tn`, which renders the `an` trigger with
 *   `collapse: "xs"` (@25656); on → `yn`, whose trigger passes `"secondary"`
 *   (@42887). Both `xs` and `secondary` resolve to a 440px/300px pair in which
 *   only `xs` applies at 300px, and we mirror the unflagged default.
 * - Reasoning effort: `collapse: "sm"` — hidden at <=440px
 *   (`app-initial-fee819fe4f22.js` @5298263, the `vHi` wrapping the effort
 *   label inside the model trigger's selected value).
 * - Model name: never collapses. Official renders it with `collapse: "none"`,
 *   which is what keeps a narrow composer from becoming an unlabelled row of
 *   icons — the reader can always see which model is about to answer.
 *
 * The icons are deliberately not gated: official keeps them at every width, so
 * each control stays operable (and its `aria-label` intact) after its text goes.
 */

type Entry = { contentRect: { width: number } };
let observers: { fire: (width: number) => void }[] = [];
const realObserver = globalThis.ResizeObserver;

vi.mock("./NativeFullAccessConfirmation", () => ({
  useNativeFullAccessConfirmation: () => ({
    ask: async () => true,
    confirmation: null,
    open: false,
  }),
}));

// Both controls read the thread's model settings. The tiers under test are
// width-driven, so the settings only need to be *present* — an unset model
// renders an empty model name, which would make "the name survived" vacuous.
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "gpt-6.1-sol",
    modelProvider: "openai",
    reasoningEffort: "xhigh",
    accessMode: "read-only",
    collaborationMode: "default",
  }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    providerItems: () => [],
    openAiModels: [],
    modelStatus: "error",
  }),
}));

beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(private cb: (entries: Entry[]) => void) {}
    observe() {
      observers.push({
        fire: (width) => this.cb([{ contentRect: { width } }]),
      });
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = realObserver;
});

const resize = (width: number) =>
  act(() => {
    for (const observer of observers) observer.fire(width);
  });

const mount = () =>
  render(
    <div className="session-mode">
      <ComposerToolbarProvider className="session-composer-toolbar">
        <AccessModePopover threadId={null} />
        <NativeModelTrigger />
      </ComposerToolbarProvider>
    </div>,
  );

const text = (selector: string) =>
  document.querySelector<HTMLElement>(selector)?.textContent ?? null;

it("collapses the permissions label only below the xs tier", () => {
  mount();
  resize(900);
  const wide = text(".session-access-trigger");
  expect(wide).not.toBe("");
  // 301px is one pixel above official's inclusive `width<=300px`.
  resize(301);
  expect(text(".session-access-trigger")).toBe(wide);
  resize(300);
  expect(text(".session-access-trigger")).toBe("");
});

it("collapses the reasoning effort at the sm tier, keeping the model name", () => {
  mount();
  resize(900);
  const effort = text(".session-native-model-effort");
  expect(effort).not.toBe("");
  const model = text(".session-native-model-label");
  expect(model).not.toBe("");

  resize(441);
  expect(text(".session-native-model-effort")).toBe(effort);

  resize(440);
  expect(text(".session-native-model-effort")).toBe("");
  // The model name is `collapse: "none"` and must survive every width.
  expect(text(".session-native-model-label")).toBe(model);
  resize(120);
  expect(text(".session-native-model-label")).toBe(model);
});

it("keeps both controls operable and labelled once their text collapses", () => {
  // Collapsing is a visual change only. If the accessible name went with the
  // text, a narrow composer would expose two unlabelled buttons — and the
  // permissions one opens a menu that can grant full disk and network access.
  mount();
  resize(200);
  const permissions = document.querySelector<HTMLElement>(
    ".session-access-trigger",
  )!;
  expect(permissions.getAttribute("aria-label")).toMatch(/^执行权限：/);
  expect(permissions.hasAttribute("disabled")).toBe(false);

  const model = document.querySelector<HTMLElement>(".session-model-trigger")!;
  expect(model.getAttribute("aria-label")).toMatch(/^模型：/);
  expect(model.hasAttribute("disabled")).toBe(false);
});

it("leaves labels in place when no footer provider measures them", () => {
  // Both controls also render outside the composer footer (side panel header,
  // sheets). Without a provider there is nothing to measure, so they must not
  // collapse to their icons on the strength of a missing measurement.
  render(
    <div className="session-mode">
      <AccessModePopover threadId={null} />
      <NativeModelTrigger />
    </div>,
  );
  expect(text(".session-access-trigger")).not.toBe("");
  expect(text(".session-native-model-effort")).not.toBe("");
});
