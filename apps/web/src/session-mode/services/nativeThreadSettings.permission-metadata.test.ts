import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeThreadSettings } from "./nativeThreadSettings";
import {
  hydrateThreadModel,
  useThreadModelStore,
  type ThreadModelEntry,
} from "@session/stores/useThreadModelStore";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";

type Profile = { id: string; extends: string | null };
type Field<T> = { kind: "value"; value: T } | { kind: "invalid" };
type Metadata = {
  activePermissionProfile?: Field<Profile | null>;
  runtimeWorkspaceRoots?: Field<readonly string[]>;
};
type Entry = ThreadModelEntry & { nativePermissionMetadata?: Metadata };
const A = "fixture-e5-normalizer-a";
const B = "fixture-e5-normalizer-b";
const fetchIO = vi.fn();
const base = {
  model: "fixture-model-a",
  modelProvider: "openai",
  reasoningEffort: "medium" as const,
  serviceTier: null,
  sandbox: { type: "readOnly" as const, networkAccess: false },
  approvalPolicy: "on-request" as const,
  approvalsReviewer: "user" as const,
};
const entry = () => useThreadModelStore.getState().threads[A] as Entry;
const metadata = () => entry().nativePermissionMetadata;
const receive = (fields: Record<string, unknown>, fallback?: unknown) =>
  hydrateThreadModel(A, nativeThreadSettings({ ...base, ...fields }, fallback));

beforeEach(() => {
  localStorage.clear();
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({ model: "fixture-default", modelProvider: "openai", reasoningEffort: "high" });
  hydrateThreadModel(A, base);
  hydrateThreadModel(B, { model: "fixture-model-b", reasoningEffort: "low" });
  fetchIO.mockReset().mockImplementation(() => { throw new Error("Unexpected external IO in E5 data fixture"); });
  vi.stubGlobal("fetch", fetchIO);
});
afterEach(() => {
  expect(fetchIO).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("primary native permission observation through existing normalization and hydration", () => {
  it("retains only exact profile and roots data, clones producers, and preserves unrelated settings", () => {
    const other = useThreadModelStore.getState().threads[B];
    const defaults = useConfigStore.getState();
    const profile = { id: "fixture-profile", extends: "fixture-parent", privateExtra: "DROP_PRIVATE" };
    const roots = ["C:\\fixture\\one", "", " /fixture/space ", "/fixture/a", "/fixture/a"];
    receive({ activePermissionProfile: profile, runtimeWorkspaceRoots: roots, instructionSources: ["DROP_INSTRUCTIONS"] });
    expect(entry()).toMatchObject({ model: base.model, reasoningEffort: "medium", sandbox: "read-only", approvalPolicy: "on-request" });
    expect(useThreadModelStore.getState().threads[B]).toBe(other);
    expect(useConfigStore.getState()).toBe(defaults);
    expect(metadata()).toEqual({
      activePermissionProfile: { kind: "value", value: { id: "fixture-profile", extends: "fixture-parent" } },
      runtimeWorkspaceRoots: { kind: "value", value: ["C:\\fixture\\one", "", " /fixture/space ", "/fixture/a", "/fixture/a"] },
    });
    profile.id = "producer-mutated";
    profile.extends = "producer-parent-mutated";
    roots[0] = "/producer/mutated";
    expect(Object.isFrozen(profile)).toBe(false);
    expect(Object.isFrozen(roots)).toBe(false);
    expect(metadata()).toEqual({
      activePermissionProfile: { kind: "value", value: { id: "fixture-profile", extends: "fixture-parent" } },
      runtimeWorkspaceRoots: { kind: "value", value: ["C:\\fixture\\one", "", " /fixture/space ", "/fixture/a", "/fixture/a"] },
    });
    expect(JSON.stringify(metadata())).not.toMatch(/DROP_PRIVATE|DROP_INSTRUCTIONS/);
  });

  it("keeps missing and undefined distinct from received null and empty roots", () => {
    receive({ activePermissionProfile: null, runtimeWorkspaceRoots: [] });
    const accepted = entry();
    const acceptedMetadata = metadata();
    receive({ activePermissionProfile: undefined, runtimeWorkspaceRoots: undefined }, {
      activePermissionProfile: { id: "fallback-must-not-revive", extends: null },
      runtimeWorkspaceRoots: ["/fallback/must-not-revive"],
    });
    expect(entry()).toBe(accepted);
    expect(metadata()).toBe(acceptedMetadata);
    expect(metadata()).toEqual({ activePermissionProfile: { kind: "value", value: null }, runtimeWorkspaceRoots: { kind: "value", value: [] } });
  });

  it("does not invent observations from fallback, UNKNOWN, sandbox or inherited non-wire keys", () => {
    const before = entry();
    receive({}, { activePermissionProfile: { id: ":danger-full-access", extends: null }, runtimeWorkspaceRoots: ["/fallback"] });
    const inherited = Object.assign(Object.create({ activePermissionProfile: { id: "inherited", extends: null }, runtimeWorkspaceRoots: ["/inherited"] }), base);
    hydrateThreadModel(A, nativeThreadSettings(inherited));
    expect(entry()).toBe(before);
    expect(metadata()).toBeUndefined();
    // Object.create is an own-key unit negative control, not a JSON-wire security claim.
  });

  it("records malformed own fields as invalid independently, replacing rather than retaining older good data", () => {
    receive({ activePermissionProfile: { id: "old-good", extends: null }, runtimeWorkspaceRoots: ["/old-good"] });
    receive({ activePermissionProfile: { id: "bad-missing-extends" }, runtimeWorkspaceRoots: ["/valid-other-field"] });
    expect(metadata()).toEqual({ activePermissionProfile: { kind: "invalid" }, runtimeWorkspaceRoots: { kind: "value", value: ["/valid-other-field"] } });
    receive({ activePermissionProfile: { id: "new-good", extends: null, secret: "DROP_SECRET" }, runtimeWorkspaceRoots: ["/would-be-filtered", 7, { secret: "DROP_SECRET" }] });
    expect(metadata()).toEqual({ activePermissionProfile: { kind: "value", value: { id: "new-good", extends: null } }, runtimeWorkspaceRoots: { kind: "invalid" } });
    receive({ activePermissionProfile: [], runtimeWorkspaceRoots: null });
    expect(metadata()).toEqual({ activePermissionProfile: { kind: "invalid" }, runtimeWorkspaceRoots: { kind: "invalid" } });
    expect(JSON.stringify(metadata())).not.toContain("DROP_SECRET");
  });

  it("accepts empty and whitespace profile strings as data without normalizing them", () => {
    receive({ activePermissionProfile: { id: "", extends: "  " }, runtimeWorkspaceRoots: ["", "  "] });
    expect(metadata()).toEqual({ activePermissionProfile: { kind: "value", value: { id: "", extends: "  " } }, runtimeWorkspaceRoots: { kind: "value", value: ["", "  "] } });
  });

  it("uses independent 4096 UTF8 byte profile string limits, including mixed text and plus-one overflow", () => {
    const exactMixed = "界".repeat(1365) + "x"; // 4096 UTF8 bytes, 1366 code units.
    const exactAscii = "a".repeat(4096);
    receive({ activePermissionProfile: { id: exactMixed, extends: exactAscii } });
    expect(metadata()?.activePermissionProfile).toEqual({ kind: "value", value: { id: exactMixed, extends: exactAscii } });
    receive({ activePermissionProfile: { id: exactMixed + "x", extends: null } });
    expect(metadata()?.activePermissionProfile).toEqual({ kind: "invalid" });
    receive({ activePermissionProfile: { id: "ok", extends: exactAscii + "x" } });
    expect(metadata()?.activePermissionProfile).toEqual({ kind: "invalid" });
  });

  it("enforces roots count and per-item limits on the whole field without filtering or truncation", () => {
    const countBoundary = Array.from({ length: 256 }, (_, i) => `/fixture/${i}`);
    receive({ runtimeWorkspaceRoots: countBoundary });
    expect(metadata()?.runtimeWorkspaceRoots).toEqual({ kind: "value", value: countBoundary });
    receive({ runtimeWorkspaceRoots: [...countBoundary, "/one-too-many"] });
    expect(metadata()?.runtimeWorkspaceRoots).toEqual({ kind: "invalid" });
    const exactItem = "/" + "界".repeat(1365); // 4096 UTF8 bytes.
    receive({ runtimeWorkspaceRoots: [exactItem] });
    expect(metadata()?.runtimeWorkspaceRoots).toEqual({ kind: "value", value: [exactItem] });
    receive({ runtimeWorkspaceRoots: [exactItem + "x"] });
    expect(metadata()?.runtimeWorkspaceRoots).toEqual({ kind: "invalid" });
  });

  it("accepts 65536 root bytes independently of both profile budgets, then invalidates total plus one", () => {
    const exactItem = "/" + "界".repeat(1365);
    const roots = Array.from({ length: 16 }, () => exactItem); // 16*4096=65536 raw string bytes.
    const profile = { id: "i".repeat(4096), extends: "e".repeat(4096) };
    receive({ activePermissionProfile: profile, runtimeWorkspaceRoots: roots });
    expect(metadata()).toEqual({ activePermissionProfile: { kind: "value", value: profile }, runtimeWorkspaceRoots: { kind: "value", value: roots } });
    receive({ activePermissionProfile: { id: "still-valid", extends: null }, runtimeWorkspaceRoots: [...roots, "x"] });
    expect(metadata()).toEqual({ activePermissionProfile: { kind: "value", value: { id: "still-valid", extends: null } }, runtimeWorkspaceRoots: { kind: "invalid" } });
  });

  it("keeps the existing settings normalization and duplicate behavior when no new field is offered", () => {
    const value = nativeThreadSettings({ model: base.model, effort: null, serviceTier: "fast", sandbox: { type: "externalSandbox", networkAccess: "restricted" }, approvalPolicy: "on-request", approvalsReviewer: "user" });
    hydrateThreadModel(A, value);
    const before = entry();
    hydrateThreadModel(A, value);
    expect(entry()).toBe(before);
    expect(entry()).toMatchObject({ reasoningEffort: null, serviceTier: "fast", sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" } });
    expect(metadata()).toBeUndefined();
  });
});
