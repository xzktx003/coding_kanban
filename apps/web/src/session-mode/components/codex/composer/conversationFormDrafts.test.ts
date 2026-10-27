import { afterEach, beforeEach, expect, it } from "vitest";
import {
  changeConversationForm,
  releaseEmptyConversationForm,
  reserveConversationForm,
  resetConversationFormDraftsForTests,
  startConversationFormUnloadGuard,
  useConversationFormDrafts,
} from "./conversationFormDrafts";
let stopGuard: () => void;
beforeEach(() => {
  resetConversationFormDraftsForTests();
  stopGuard = startConversationFormUnloadGuard();
});
afterEach(() => stopGuard());
it("retains all dirty owners at capacity and explicitly rejects a new owner instead of evicting", () => {
  for (let i = 0; i < 64; i++)
    changeConversationForm("owner-" + i, "notes", "unsaved-" + i);
  expect(() => reserveConversationForm("overflow")).toThrow("已满");
  expect(Object.keys(useConversationFormDrafts.getState().drafts)).toHaveLength(
    64,
  );
  expect(
    useConversationFormDrafts.getState().drafts["owner-0"].fields.notes,
  ).toBe("unsaved-0");
  changeConversationForm("owner-0", "notes", "");
  releaseEmptyConversationForm("owner-0");
  expect(() => reserveConversationForm("replacement")).not.toThrow();
});
it("rejects excess text without replacing already accepted fields", () => {
  changeConversationForm("owner", "notes", "original");
  changeConversationForm("owner", "notes", "x".repeat(1024 * 1024 + 1));
  expect(useConversationFormDrafts.getState().drafts.owner.fields.notes).toBe(
    "original",
  );
});
it("warns on hard navigation while dirty, and releases the warning after explicit clear", () => {
  changeConversationForm("owner", "notes", "keep");
  const first = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  changeConversationForm("owner", "notes", "");
  releaseEmptyConversationForm("owner");
  const second = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(second);
  expect(second.defaultPrevented).toBe(false);
});
it("keeps a clean entry while another mounted owner form still references it", async () => {
  const { retainConversationForm } = await import("./conversationFormDrafts");
  const first = retainConversationForm("shared"),
    second = retainConversationForm("shared");
  first();
  expect(useConversationFormDrafts.getState().drafts.shared).toBeDefined();
  second();
  expect(useConversationFormDrafts.getState().drafts.shared).toBeUndefined();
});
it("does not notify subscribers when an obsolete receipt changes nothing", async () => {
  const { updateConversationForm } = await import("./conversationFormDrafts");
  reserveConversationForm("owner");
  let notifications = 0;
  const off = useConversationFormDrafts.subscribe(() => notifications++);
  updateConversationForm("owner", (d) => d);
  off();
  expect(notifications).toBe(0);
});
