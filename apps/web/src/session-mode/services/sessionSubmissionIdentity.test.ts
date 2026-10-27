import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { stableSubmissionId } from "./sessionSubmissionIdentity";
import { MutationNotStartedError } from "./MutationNotStartedError";
import { isCurrentSessionEditId } from "./sessionEditIdentity";

const oldKey = "kanban.session.followup-submissions";
const owner = "owner";
const data = {
  threadId: "thread",
  text: "same text",
  images: [],
  mode: "queue",
  parameters: {},
};
const editId = (n: number) =>
  "edit3_00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const edit = { revision: 1, writeId: editId(1) };
const legacyKey = () =>
  createHash("sha256")
    .update(JSON.stringify({ owner, revision: 1, data }))
    .digest("hex");
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("reuses a captured edit even when another page loses or removes its local marker", async () => {
  const id = await stableSubmissionId(owner, edit, data);
  localStorage.clear();
  expect(await stableSubmissionId(owner, edit, data)).toBe(id);
});
it("distinguishes independent same-text edits with colliding page-local revision counters", async () => {
  const a = await stableSubmissionId(owner, edit, data);
  expect(
    await stableSubmissionId(owner, { ...edit, writeId: editId(2) }, data),
  ).not.toBe(a);
  expect(await stableSubmissionId(owner, { ...edit }, data)).toBe(a);
});
it("never rewrites the shared legacy map when recording a new edit", async () => {
  await stableSubmissionId(owner, edit, data);
  expect(localStorage.getItem(oldKey)).toBeNull();
});
it("preserves a known legacy retry ID and pins it independently before the legacy map can be overwritten", async () => {
  localStorage.setItem(
    oldKey,
    JSON.stringify({ [legacyKey()]: "old-request-id" }),
  );
  expect(await stableSubmissionId(owner, 1, data)).toBe("old-request-id");
  localStorage.setItem(oldKey, "{}");
  expect(await stableSubmissionId(owner, 1, data)).toBe("old-request-id");
});
it("rejects an ambiguous legacy mapping instead of assigning a new ID or silently reusing another edit", async () => {
  localStorage.setItem(
    oldKey,
    JSON.stringify({ [legacyKey()]: "old-unknown-delivery" }),
  );
  await expect(
    stableSubmissionId(owner, { ...edit, writeId: "old-uuid" }, data),
  ).rejects.toThrow(/旧.*提交.*无法核实/);
});
it("does not manufacture a new ID for an unidentifiable old draft whose retry record is missing", async () => {
  await expect(stableSubmissionId(owner, 1, data)).rejects.toThrow(
    /旧.*提交.*无法核实/,
  );
});
it("distinguishes re-added attachments with identical paths while retrying the same captured attachment", async () => {
  const blank = { ...data, text: "", images: ["/same.png"] };
  const a = { revision: 0, attachmentIds: [editId(3)] };
  const id = await stableSubmissionId(owner, a, blank);
  expect(await stableSubmissionId(owner, a, blank)).toBe(id);
  expect(
    await stableSubmissionId(
      owner,
      { revision: 0, attachmentIds: [editId(4)] },
      blank,
    ),
  ).not.toBe(id);
});

it("a deliberate edit and restoration of the same wording escapes the ambiguous legacy revision", async () => {
  localStorage.setItem(
    oldKey,
    JSON.stringify({ [legacyKey()]: "old-unknown-delivery" }),
  );
  await expect(
    stableSubmissionId(owner, { ...edit, writeId: "old-uuid" }, data),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
  const next = { revision: 3, writeId: editId(5) };
  expect(await stableSubmissionId(owner, next, data)).toMatch(
    /^draft3_[a-f0-9]{64}$/,
  );
});
it("does not downgrade a confirmed new identity after an old page later writes the legacy map", async () => {
  const id = await stableSubmissionId(owner, edit, data);
  localStorage.setItem(
    oldKey,
    JSON.stringify({ [legacyKey()]: "unrelated-old-id" }),
  );
  expect(await stableSubmissionId(owner, edit, data)).toBe(id);
});
it("storage failures reject before mutation rather than returning an unrecorded identity", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  await expect(stableSubmissionId(owner, edit, data)).rejects.toBeInstanceOf(
    MutationNotStartedError,
  );
});
it.each(["null", "[]", "broken JSON"])(
  "rejects unreadable legacy metadata %s without replacing it",
  async (raw) => {
    localStorage.setItem(oldKey, raw);
    await expect(stableSubmissionId(owner, 1, data)).rejects.toBeInstanceOf(
      MutationNotStartedError,
    );
    expect(localStorage.getItem(oldKey)).toBe(raw);
  },
);
it("evicts only reconstructible markers and never changes an evicted edit ID", async () => {
  const first = await stableSubmissionId(owner, edit, data);
  for (let index = 0; index < 1002; index++)
    await stableSubmissionId(
      owner,
      { revision: index + 2, writeId: editId(index + 10) },
      data,
    );
  expect(
    Object.keys(localStorage).filter((key) =>
      key.startsWith("kanban.session.submission.v3."),
    ).length,
  ).toBeLessThanOrEqual(1000);
  expect(await stableSubmissionId(owner, edit, data)).toBe(first);
});

it("old ordinary IDs never become new intent when their legacy retry record is missing", async () => {
  await expect(
    stableSubmissionId(
      owner,
      { revision: 1, writeId: "ordinary-old-uuid" },
      data,
    ),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
  await expect(
    stableSubmissionId(
      owner,
      { revision: 0, attachmentIds: ["old-photo"] },
      { ...data, text: "" },
    ),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
  await expect(
    stableSubmissionId(
      owner,
      { revision: 0, contextIds: ["old-reference"] },
      { ...data, text: "" },
    ),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
});
it("a proven new edit is independent of an old same-text revision mapping", async () => {
  localStorage.setItem(oldKey, JSON.stringify({ [legacyKey()]: "old-id" }));
  expect(await stableSubmissionId(owner, edit, data)).toMatch(/^draft3_/);
  expect(
    await stableSubmissionId(
      owner,
      { revision: 0, contextIds: [editId(6)] },
      { ...data, text: "" },
    ),
  ).toMatch(/^draft3_/);
});
it("object key order does not change a captured submission while array order remains significant", async () => {
  const a = {
    ...data,
    parameters: { model: "fixture", cwd: "/fixture" },
    images: ["/a", "/b"],
  };
  const b = {
    images: ["/a", "/b"],
    parameters: { cwd: "/fixture", model: "fixture" },
    mode: data.mode,
    text: data.text,
    threadId: data.threadId,
  };
  const first = await stableSubmissionId(owner, edit, a);
  expect(await stableSubmissionId(owner, edit, b)).toBe(first);
  expect(
    await stableSubmissionId(owner, edit, { ...a, images: ["/b", "/a"] }),
  ).not.toBe(first);
});
it("an exact v2 binding retains its original ID and an unknown reordered v2 retry never gets a fresh ID", async () => {
  const oldEdit = {
    revision: 1,
    writeId: "edit2_00000000-0000-4000-8000-000000000001",
  };
  const original = {
    ...data,
    parameters: { model: "fixture", cwd: "/fixture" },
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        version: 2,
        owner,
        revision: 1,
        identity: { writeId: oldEdit.writeId },
        data: original,
      }),
    )
    .digest("hex");
  localStorage.setItem("kanban.session.submission.v2." + hash, "draft_" + hash);
  expect(await stableSubmissionId(owner, oldEdit, original)).toBe(
    "draft_" + hash,
  );
  await expect(
    stableSubmissionId(owner, oldEdit, {
      ...original,
      parameters: { cwd: "/fixture", model: "fixture" },
    }),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
  expect(await stableSubmissionId(owner, edit, original)).toMatch(/^draft3_/);
});
it("does not skip a conflicting legacy alias when another page evicts an earlier marker during enumeration", async () => {
  const evicted = "kanban.session.submission.v3.older-marker";
  const prefix = "kanban.session.submission.legacy." + legacyKey();
  localStorage.setItem(evicted, "old-marker");
  localStorage.setItem(prefix + ".first", "first-id");
  localStorage.setItem(prefix + ".second", "second-id");
  const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key,
  ) {
    if (key === prefix + ".first") this.removeItem(evicted);
    return get.call(this, key);
  });
  await expect(stableSubmissionId(owner, 1, data)).rejects.toBeInstanceOf(
    MutationNotStartedError,
  );
});

it("automatic legacy-input migration is not a new edit; an actual edit and restore enables a new submission", async () => {
  const { useSessionDraftStore, readDraft } = await import("../stores/useSessionDraftStore");
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  localStorage.setItem("kanban.session.input-storage", JSON.stringify({ state: { inputValue: data.text } }));
  useSessionDraftStore.getState().migrateLegacy("codex", owner);
  const imported = readDraft(owner);
  expect(imported.text).toBe(data.text);
  expect(isCurrentSessionEditId(imported.writeId)).toBe(false);
  await expect(stableSubmissionId(owner, imported, data)).rejects.toBeInstanceOf(MutationNotStartedError);
  useSessionDraftStore.getState().setText(owner, data.text + " edited");
  useSessionDraftStore.getState().setText(owner, data.text);
  const edited = readDraft(owner);
  expect(isCurrentSessionEditId(edited.writeId)).toBe(true);
  expect(await stableSubmissionId(owner, edited, data)).toMatch(/^draft3_/);
});
