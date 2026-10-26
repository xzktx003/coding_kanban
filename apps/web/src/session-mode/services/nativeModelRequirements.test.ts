import { Buffer } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readNativeConfigRequirements, type NativeConfigRequirements } from "./nativeConfigCapabilities";

const transport = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("./apiAdapt/shared", () => ({ postJsonWithOptions: transport.post }));
const SUBJECT_MODULES = import.meta.glob("./nativeModelRequirements.ts");
type KnownSource = "native-null" | "auto-review-absent" | "auto-review-null" |
  "required-models-absent" | "required-models-null" | "required-models-list";
type Known = {
  readonly status: "known";
  readonly runtimeInstance: string;
  readonly autoReviewSource: KnownSource;
  readonly requiredOnModels: readonly string[] | null;
};
type Decoded = Known | { readonly status: "unavailable" };
type API = {
  decodeNativeModelRequirements(dto: unknown, expectedRuntimeInstance: unknown): Decoded;
  isAutoReviewRequiredForModel(known: Known, target: string | null | undefined): boolean;
};
const CAPTURED_INSTANCE = "r28d1-independently-captured-A";
const forbiddenFetch = vi.fn(() => { throw Error("R28D1_UNEXPECTED_HTTP"); });
let allowedExistingHelperReads = 0;

async function actualAPI(): Promise<API> {
  expect(typeof SUBJECT_MODULES["./nativeModelRequirements.ts"], "new decoder module must exist (availability only)").toBe("function");
  const module = await vi.importActual<Record<string, unknown>>("./nativeModelRequirements");
  for (const name of ["decodeNativeModelRequirements", "isAutoReviewRequiredForModel"]) {
    expect(typeof module[name], `${name} must be available (availability only)`).toBe("function");
  }
  // After existence, resolver/type/loader errors are harness errors, never relabeled as behavioral RED.
  return module as unknown as API;
}
function permissions() {
  return { allowedApprovalPolicies: null, allowedApprovalsReviewers: null,
    allowedSandboxModes: null, allowedPermissionProfiles: null, defaultPermissions: null };
}
function projected(source: KnownSource, names: string[] = []): NativeConfigRequirements {
  const autoReview = source === "auto-review-absent" || source === "auto-review-null" ? null :
    { requiredOnModels: source === "required-models-list" ? names : null };
  return {
    requirements: source === "native-null" ? null : { ...permissions(), autoReview },
    projection: { version: 1, source: "configRequirements/read", scope: "runtime-global",
      runtimeInstance: CAPTURED_INSTANCE, status: "known", autoReviewSource: source },
  };
}
function listValue(value: unknown): unknown {
  return { ...projected("required-models-list"),
    requirements: { ...permissions(), autoReview: { requiredOnModels: value } } };
}
function requireKnown(value: Decoded): Known {
  expect(value.status).toBe("known");
  if (value.status !== "known") throw Error("fixture must decode known");
  return value;
}
function freezeData(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
}
beforeEach(() => {
  allowedExistingHelperReads = 0;
  transport.post.mockReset().mockImplementation(() => { throw Error("R28D1_UNEXPECTED_EXISTING_READ"); });
  forbiddenFetch.mockClear();
  vi.stubGlobal("fetch", forbiddenFetch);
});
afterEach(() => {
  try {
    expect(forbiddenFetch).not.toHaveBeenCalled();
    expect(transport.post).toHaveBeenCalledTimes(allowedExistingHelperReads);
  } finally { vi.unstubAllGlobals(); }
});

const SOURCES: KnownSource[] = ["native-null", "auto-review-absent", "auto-review-null",
  "required-models-absent", "required-models-null", "required-models-list"];
it.each(SOURCES)("decodes the exact own normalized source pairing: %s", async source => {
  const api = await actualAPI(), names = ["gpt-5.6-sol"];
  const dto = projected(source, names), before = structuredClone(dto);
  freezeData(dto);
  const result = requireKnown(api.decodeNativeModelRequirements(dto, CAPTURED_INSTANCE));
  expect(result).toEqual({ status: "known", runtimeInstance: CAPTURED_INSTANCE,
    autoReviewSource: source, requiredOnModels: source === "required-models-list" ? names : null });
  expect(Object.isFrozen(result)).toBe(true);
  expect(api.isAutoReviewRequiredForModel(result, "gpt-5.6-sol")).toBe(source === "required-models-list");
  expect(dto).toEqual(before);
});

const MIXED_512 = "界".repeat(170) + "ab";
const BOUNDS: { name: string; list: string[]; known: boolean }[] = [
  { name: "256 entries", list: Array.from({ length: 256 }, () => "sol"), known: true },
  { name: "257 entries", list: Array.from({ length: 257 }, () => "sol"), known: false },
  { name: "ASCII 512 bytes", list: ["a".repeat(512)], known: true },
  { name: "ASCII 513 bytes", list: ["a".repeat(513)], known: false },
  { name: "mixed UTF8 512 bytes", list: [MIXED_512], known: true },
  { name: "mixed UTF8 513 bytes", list: ["界".repeat(170) + "abc"], known: false },
  { name: "astral UTF8 512 bytes", list: ["🧪".repeat(128)], known: true },
  { name: "astral UTF8 516 bytes", list: ["🧪".repeat(129)], known: false },
  { name: "aggregate 65536 bytes", list: Array.from({ length: 128 }, () => MIXED_512), known: true },
  { name: "aggregate 65537 bytes", list: [...Array.from({ length: 128 }, () => MIXED_512), "x"], known: false },
  { name: "count and aggregate maxima together", list: Array.from({ length: 256 }, () => "a".repeat(256)), known: true },
];
it.each(BOUNDS)("applies A local budgets without partial data: $name", async fixture => {
  const api = await actualAPI(), dto = listValue(fixture.list), before = structuredClone(dto);
  freezeData(dto);
  const result = api.decodeNativeModelRequirements(dto, CAPTURED_INSTANCE);
  if (fixture.known) expect(requireKnown(result).requiredOnModels).toEqual(fixture.list);
  else expect(result).toEqual({ status: "unavailable" });
  expect(dto).toEqual(before);
});

const QUERIES: { name: string; list: string[] | null; target: string | null | undefined; expected: boolean }[] = [
  { name: "null target", list: ["gpt-5.6-sol"], target: null, expected: false },
  { name: "undefined target", list: ["gpt-5.6-sol"], target: undefined, expected: false },
  { name: "native null requirements", list: null, target: "gpt-5.6-sol", expected: false },
  { name: "ordinary Sol exact", list: ["gpt-5.6-sol"], target: "gpt-5.6-sol", expected: true },
  { name: "ordinary Terra exact", list: ["gpt-5.6-terra"], target: "gpt-5.6-terra", expected: true },
  { name: "case remains exact", list: ["Sol"], target: "sol", expected: false },
  { name: "valid single provider prefix", list: ["gpt-5.6-sol"], target: "OPENAI_1-model/gpt-5.6-sol", expected: true },
  { name: "Unicode canonical unchanged", list: ["模型Ω"], target: "模型Ω", expected: true },
  { name: "Unicode suffix unchanged", list: ["模型Ω"], target: "openai/模型Ω", expected: true },
  { name: "empty provider prefix", list: ["gpt-5.6-sol"], target: "/gpt-5.6-sol", expected: false },
  { name: "multiple slashes", list: ["gpt-5.6-sol"], target: "openai/other/gpt-5.6-sol", expected: false },
  { name: "invalid dotted provider prefix", list: ["gpt-5.6-sol"], target: "bad.prefix/gpt-5.6-sol", expected: false },
  { name: "invalid Unicode provider prefix", list: ["gpt-5.6-sol"], target: "提供商/gpt-5.6-sol", expected: false },
  { name: "requirement list is never normalized", list: ["openai/gpt-5.6-sol"], target: "openai/gpt-5.6-sol", expected: false },
  { name: "target never trimmed", list: ["gpt-5.6-sol"], target: " gpt-5.6-sol", expected: false },
  { name: "exact whitespace canonical", list: [" Sol "], target: " Sol ", expected: true },
  { name: "empty suffix has no nonempty list match", list: ["gpt-5.6-sol"], target: "openai/", expected: false },
  { name: "C1 remains a literal name", list: ["a\u0085b"], target: "a\u0085b", expected: true },
];
it.each(QUERIES)("queries known data with original F_t/G_t semantics: $name", async fixture => {
  const api = await actualAPI();
  const known = requireKnown(api.decodeNativeModelRequirements(fixture.list === null ?
    projected("native-null") : projected("required-models-list", fixture.list), CAPTURED_INSTANCE));
  const before = structuredClone(known); freezeData(known);
  expect(api.isAutoReviewRequiredForModel(known, fixture.target)).toBe(fixture.expected);
  expect(known).toEqual(before);
});

it("keeps an empty verified list known, distinct from native null and unavailable", async () => {
  const api = await actualAPI();
  const result = requireKnown(api.decodeNativeModelRequirements(projected("required-models-list", []), CAPTURED_INSTANCE));
  expect(result).toEqual({ status: "known", runtimeInstance: CAPTURED_INSTANCE,
    autoReviewSource: "required-models-list", requiredOnModels: [] });
  expect(api.isAutoReviewRequiredForModel(result, "sol")).toBe(false);
});

it("preserves exact ordered names and permits unrelated future fields without granting old permissions", async () => {
  const api = await actualAPI();
  const names = ["gpt-5.6-terra", "gpt-5.6-sol", "Sol", "sol", " Sol ", "模型Ω", "provider/sol", "gpt-5.6-terra", "a\u0085b"];
  const dto = { ...projected("required-models-list", names), futureTop: { notAuthority: true },
    projection: { ...projected("required-models-list").projection!, futureMarker: "not interpreted" },
    requirements: { ...permissions(), allowedApprovalPolicies: { notValidatedByD1: true },
      defaultPermissions: { notValidatedByD1: true }, futureRequirement: 7,
      autoReview: { requiredOnModels: names, futureAutoReview: true } } };
  const before = structuredClone(dto); freezeData(dto);
  const result = requireKnown(api.decodeNativeModelRequirements(dto, CAPTURED_INSTANCE));
  expect(result).toEqual({ status: "known", runtimeInstance: CAPTURED_INSTANCE,
    autoReviewSource: "required-models-list", requiredOnModels: names });
  expect(result.requiredOnModels).not.toBe(names);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.requiredOnModels)).toBe(true);
  expect(dto).toEqual(before);
});

it("detaches the returned list from later mutations to the caller raw DTO", async () => {
  const api = await actualAPI(), names = ["sol", "sol"], dto = projected("required-models-list", names);
  const before = structuredClone(dto);
  const result = requireKnown(api.decodeNativeModelRequirements(dto, CAPTURED_INSTANCE));
  expect(dto).toEqual(before);
  expect(result.requiredOnModels).not.toBe(names);
  names[0] = "caller-mutated"; names.push("caller-added");
  expect(result.requiredOnModels).toEqual(["sol", "sol"]);
});

it("does not convert legacy, failed, unsupported or unknown envelopes into no requirements", async () => {
  const api = await actualAPI();
  const rows: unknown[] = [undefined, null, false, "legacy", [], new Error("fixture read unavailable"), {},
    { requirements: null }, { requirements: { ...permissions(), autoReview: null } },
    { requirements: null, projection: undefined },
    { requirements: { ...permissions(), autoReview: null }, projection: {
      version: 1, source: "configRequirements/read", scope: "runtime-global", runtimeInstance: CAPTURED_INSTANCE,
      status: "unavailable", autoReviewSource: "invalid" } }];
  for (const dto of rows) expect(api.decodeNativeModelRequirements(dto, CAPTURED_INSTANCE)).toEqual({ status: "unavailable" });
});

it("requires all own projection discriminators, the current version and the captured instance", async () => {
  const api = await actualAPI(), dto = projected("required-models-list", ["sol"]);
  const patches: Record<string, unknown>[] = [{ version: 2 }, { version: "1" }, { source: "config/read" },
    { scope: "thread" }, { status: "unavailable" }, { status: "pending" }, { autoReviewSource: "invalid" },
    { autoReviewSource: "invented" }, { runtimeInstance: null }, { runtimeInstance: "" },
    { runtimeInstance: 7 }, { runtimeInstance: "another-instance" }];
  for (const patch of patches) expect(api.decodeNativeModelRequirements({ ...dto,
    projection: { ...dto.projection, ...patch } }, CAPTURED_INSTANCE)).toEqual({ status: "unavailable" });
  for (const key of ["version", "source", "scope", "runtimeInstance", "status", "autoReviewSource"]) {
    const projection: Record<string, unknown> = { ...dto.projection }; delete projection[key];
    expect(api.decodeNativeModelRequirements({ ...dto, projection }, CAPTURED_INSTANCE)).toEqual({ status: "unavailable" });
  }
});

it("requires an independently captured nonempty primitive expected instance without learning it from the DTO", async () => {
  const api = await actualAPI(), dto = projected("required-models-list", ["sol"]);
  for (const expected of [undefined, null, "", 1, {}, "r28d1-B", ` ${CAPTURED_INSTANCE}`]) {
    expect(api.decodeNativeModelRequirements(dto, expected)).toEqual({ status: "unavailable" });
  }
});

it("rejects source and normalized own payload contradictions instead of inferring absence", async () => {
  const api = await actualAPI();
  const rows: unknown[] = [
    { ...projected("native-null"), requirements: { ...permissions(), autoReview: null } },
    { ...projected("auto-review-null"), requirements: null },
    { ...projected("auto-review-absent"), requirements: { ...permissions() } },
    { ...projected("auto-review-null"), requirements: { ...permissions(), autoReview: { requiredOnModels: null } } },
    { ...projected("required-models-absent"), requirements: { ...permissions(), autoReview: null } },
    { ...projected("required-models-absent"), requirements: { ...permissions(), autoReview: {} } },
    { ...projected("required-models-null"), requirements: { ...permissions(), autoReview: { requiredOnModels: [] } } },
    { ...projected("required-models-list"), requirements: { ...permissions(), autoReview: { requiredOnModels: null } } },
    { ...projected("required-models-list"), requirements: { ...permissions(), autoReview: { requiredOnModels: undefined } } },
    { ...projected("required-models-list"), requirements: [] },
    { ...projected("required-models-list"), requirements: { ...permissions(), autoReview: [] } },
  ];
  for (const dto of rows) expect(api.decodeNativeModelRequirements(dto, CAPTURED_INSTANCE)).toEqual({ status: "unavailable" });
});

it("does not accept inherited marker or inherited normalized payload fields", async () => {
  const api = await actualAPI(), dto = projected("required-models-list", ["sol"]);
  const rows: unknown[] = [Object.create(dto), { ...dto, projection: Object.create(dto.projection!) },
    { ...dto, requirements: Object.create({ ...permissions(), autoReview: { requiredOnModels: ["sol"] } }) },
    { ...dto, requirements: { ...permissions(), autoReview: Object.create({ requiredOnModels: ["sol"] }) } }];
  for (const value of rows) expect(api.decodeNativeModelRequirements(value, CAPTURED_INSTANCE)).toEqual({ status: "unavailable" });
});

it("rejects malformed entries and the entire malformed list without filtering or truncating", async () => {
  const api = await actualAPI();
  for (const value of ["sol", { model: "sol" }, [""], ["sol", ""], ["sol", 7], ["sol", null], ["sol", undefined], [false]]) {
    expect(api.decodeNativeModelRequirements(listValue(value), CAPTURED_INSTANCE)).toEqual({ status: "unavailable" });
  }
});

it("rejects every C0 codepoint and DEL without broadening the rejection to C1", async () => {
  const api = await actualAPI();
  for (const point of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
    expect(api.decodeNativeModelRequirements(listValue(["sol", `left${String.fromCharCode(point)}right`]), CAPTURED_INSTANCE))
      .toEqual({ status: "unavailable" });
  }
});

it("preserves all C1 codepoints, Unicode, order and duplicate data literally", async () => {
  const api = await actualAPI(), names = Array.from({ length: 32 }, (_, index) => `left${String.fromCharCode(128 + index)}right`);
  const dto = projected("required-models-list", names), before = structuredClone(dto); freezeData(dto);
  const result = requireKnown(api.decodeNativeModelRequirements(dto, CAPTURED_INSTANCE));
  expect(result.requiredOnModels).toEqual(names);
  expect(dto).toEqual(before);
});

it("requires unavailable decoding to be handled explicitly before the model predicate", async () => {
  const api = await actualAPI(), unavailable = api.decodeNativeModelRequirements({}, CAPTURED_INSTANCE);
  expect(unavailable).toEqual({ status: "unavailable" });
  expect(() => api.isAutoReviewRequiredForModel(unavailable as Known, "sol")).toThrow(TypeError);
});

it("rejects non-string non-nullish runtime targets even when known data has no requirement", async () => {
  const api = await actualAPI();
  const knownValues = [requireKnown(api.decodeNativeModelRequirements(projected("native-null"), CAPTURED_INSTANCE)),
    requireKnown(api.decodeNativeModelRequirements(projected("required-models-list", ["sol"]), CAPTURED_INSTANCE))];
  const invalidTargets: unknown[] = [0, 1, true, false, {}, [], () => undefined, Symbol("fixture-target"), 1n];
  for (const known of knownValues) for (const target of invalidTargets) {
    expect(() => api.isAutoReviewRequiredForModel(known, target as string)).toThrow(TypeError);
  }
});

it("control: the existing raw requirements helper returns the exact mocked transport DTO without decoding or cloning", async () => {
  const dto = projected("required-models-list", ["sol"]), before = structuredClone(dto); freezeData(dto);
  allowedExistingHelperReads = 1; transport.post.mockResolvedValueOnce(dto);
  expect(await readNativeConfigRequirements()).toBe(dto);
  expect(dto).toEqual(before);
  expect(transport.post).toHaveBeenCalledExactlyOnceWith("/api/codex/config/requirements/read", {}, { suppressToast: true });
});

it("control: the existing raw helper propagates read failure without fallback, retry or inferred no requirement", async () => {
  const error = new Error("fixture unsupported read");
  allowedExistingHelperReads = 1; transport.post.mockRejectedValueOnce(error);
  await expect(readNativeConfigRequirements()).rejects.toBe(error);
  expect(transport.post).toHaveBeenCalledExactlyOnceWith("/api/codex/config/requirements/read", {}, { suppressToast: true });
});

it("control: standard TextEncoder agrees with Node UTF8 byte lengths at mixed and surrogate boundaries", () => {
  // A unit environment check only; not actual browser or physical-device acceptance.
  const encoder = new TextEncoder();
  for (const value of [MIXED_512, "🧪".repeat(128), "é".repeat(256), "\ud800".repeat(170) + "ab", "a\u0085b"]) {
    expect(encoder.encode(value).byteLength).toBe(Buffer.byteLength(value, "utf8"));
  }
  expect(encoder.encode(MIXED_512).byteLength).toBe(512);
});
