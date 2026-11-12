import { afterEach, beforeEach, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { invalidateCodexOperationScope } from "@session/services/codexOperationScope";
import { markCodexTranscriptDormant, trackCodexTranscript, forgetCodexTranscript } from "@session/services/codexTranscriptActivity";
import { clearModelChangeAnnouncements, getModelChangeAnnouncements, recordNativeModelChange, rememberNativeModelBaseline } from "./modelChangeTranscript";
import { projectModelChangeSlots } from "./modelChangeProjection";
import type { TranscriptWorkRow } from "@session/components/codex/thread/turnWork";
import { captureThreadModelRead, changeThreadModel, hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";

const events = (id = "a", turn = "old"): ServerNotification[] => [{
  method: "item/started", params: { threadId: id, turnId: turn, startedAtMs: 1, item: { type: "userMessage", id: "message", clientId: null, content: [] } },
}];
const value = (model: string, modelProvider = "openai") => ({ model, modelProvider });
beforeEach(() => clearModelChangeAnnouncements());
afterEach(() => { clearModelChangeAnnouncements(); forgetCodexTranscript("dormant"); });

it("records an explicit provider change once and keeps changes in their own thread", () => {
  rememberNativeModelBaseline("a", value("astra"));
  rememberNativeModelBaseline("b", value("other"));
  recordNativeModelChange("a", value("astra", "custom"), events());
  recordNativeModelChange("a", value("astra", "custom"), events());
  expect(getModelChangeAnnouncements("a")).toMatchObject([{
    threadId: "a", afterTurnId: "old",
    from: { model: "astra", provider: "openai" },
    to: { model: "astra", provider: "custom" },
  }]);
  expect(getModelChangeAnnouncements("b")).toEqual([]);
  recordNativeModelChange("a", value("astra"), events("a", "next"));
  expect(getModelChangeAnnouncements("a")).toHaveLength(2);
});

it("requires a live baseline, complete identities and a real turn anchor", () => {
  recordNativeModelChange("a", value("first"), events());
  expect(getModelChangeAnnouncements("a")).toEqual([]);
  recordNativeModelChange("a", { model: "missing-provider" }, events());
  recordNativeModelChange("a", value("no-anchor"), []);
  expect(getModelChangeAnnouncements("a")).toEqual([]);
  recordNativeModelChange("a", value("foreign"), events("b"));
  expect(getModelChangeAnnouncements("a")).toEqual([]);
  recordNativeModelChange("a", value("x".repeat(1025)), events());
  expect(getModelChangeAnnouncements("a")).toEqual([]);
});

it("clears old scope and released transcripts rather than reviving their notices", () => {
  rememberNativeModelBaseline("a", value("one"));
  recordNativeModelChange("a", value("two"), events());
  invalidateCodexOperationScope();
  expect(getModelChangeAnnouncements("a")).toEqual([]);
  recordNativeModelChange("a", value("three"), events());
  expect(getModelChangeAnnouncements("a")).toEqual([]);
  trackCodexTranscript("dormant");
  rememberNativeModelBaseline("dormant", value("one"));
  markCodexTranscriptDormant("dormant");
  recordNativeModelChange("dormant", value("two"), events("dormant"));
  expect(getModelChangeAnnouncements("dormant")).toEqual([]);
});

it("does not use a stale native read as the baseline after a new local selection", () => {
  useThreadModelStore.setState({ threads: {} });
  const token = captureThreadModelRead("stale-read");
  changeThreadModel("stale-read", { model: "chosen", modelProvider: "custom" });
  hydrateThreadModel("stale-read", value("stale"), { readToken: token, modelChangeBaseline: true });
  recordNativeModelChange("stale-read", value("confirmed", "custom"), events("stale-read"));
  expect(getModelChangeAnnouncements("stale-read")).toEqual([]);
});

it("does not treat request-fallback settings as a confirmed native baseline", () => {
  hydrateThreadModel("fallback", value("requested"));
  recordNativeModelChange("fallback", value("actual", "custom"), events("fallback"));
  expect(getModelChangeAnnouncements("fallback")).toEqual([]);
});

it("places a notice after the last row of its exact prior turn and leaves missing anchors unplaced", () => {
  rememberNativeModelBaseline("a", value("one"));
  recordNativeModelChange("a", value("two"), events());
  const changes = getModelChangeAnnouncements("a");
  const rows = [
    { key: "old-user", item: { kind: "event", event: events()[0], index: 0 } },
    { key: "old-error", item: { kind: "event", event: { method: "error", params: { threadId: "a", turnId: "old", willRetry: false, error: { message: "failed" } } }, index: 1 } },
    { key: "new-user", item: { kind: "event", event: events("a", "next")[0], index: 2 } },
  ] as TranscriptWorkRow[];
  expect(projectModelChangeSlots("a", rows, changes).get("old-error")).toEqual(changes);
  expect(projectModelChangeSlots("a", rows.slice(2), changes).size).toBe(0);
  expect(projectModelChangeSlots("b", rows, changes).size).toBe(0);
});
