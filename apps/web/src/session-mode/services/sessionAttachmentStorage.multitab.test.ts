import { afterEach, expect, it, vi } from "vitest";
import type { ImageAttachment } from "../components/common/useImageAttachments";
import {
  loadAttachmentDraft,
  saveAttachmentDraft,
  moveAttachmentDraft,
} from "./sessionAttachmentStorage";

const image = (id: string): ImageAttachment => ({
  id,
  name: `${id}.png`,
  path: `/${id}.png`,
  preview: "",
  status: "ready",
});
const owner = () => `multitab:${crypto.randomUUID()}`;
afterEach(() => vi.restoreAllMocks());

it("a stale receipt removes only its submitted IDs and preserves another page's new attachment", async () => {
  const key = owner();
  await saveAttachmentDraft(key, [image("sent")], []);
  const a = await loadAttachmentDraft(key),
    b = await loadAttachmentDraft(key);
  await saveAttachmentDraft(key, [...b, image("new")], b);
  await saveAttachmentDraft(key, [], a);
  expect((await loadAttachmentDraft(key)).map((item) => item.id)).toEqual([
    "new",
  ]);
});

it("a late upload cannot resurrect an attachment removed by another page", async () => {
  const key = owner();
  await saveAttachmentDraft(key, [image("photo")], []);
  const a = await loadAttachmentDraft(key),
    b = await loadAttachmentDraft(key);
  await saveAttachmentDraft(key, [], b);
  await saveAttachmentDraft(key, [{ ...a[0], path: "/late-upload.png" }], a);
  expect(await loadAttachmentDraft(key)).toEqual([]);
});

it("serializes competing page additions in the IndexedDB transaction, including after file-byte preparation", async () => {
  const key = owner();
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      saveAttachmentDraft(key, [image(String(index))], []),
    ),
  );
  expect(
    (await loadAttachmentDraft(key)).map((item) => item.id).sort(),
  ).toEqual(Array.from({ length: 10 }, (_, index) => String(index)));
});

it("an unchanged stale item cannot overwrite another page's latest annotation while adding a different item", async () => {
  const key = owner();
  await saveAttachmentDraft(key, [image("photo")], []);
  const a = await loadAttachmentDraft(key),
    b = await loadAttachmentDraft(key);
  await saveAttachmentDraft(key, [{ ...b[0], name: "annotated.png" }], b);
  await saveAttachmentDraft(key, [...a, image("new")], a);
  expect((await loadAttachmentDraft(key))[0].name).toBe("annotated.png");
});

it("a stale upload changes only its own fields and retains another page's drawing", async () => {
  const key = owner();
  await saveAttachmentDraft(key, [image("photo")], []);
  const a = await loadAttachmentDraft(key),
    b = await loadAttachmentDraft(key);
  const drawing = {
    document: { version: 1 as const, width: 10, height: 10, marks: [] },
    originalPath: "/original.png",
  };
  await saveAttachmentDraft(
    key,
    [{ ...b[0], drawing, name: "annotated.png" }],
    b,
  );
  await saveAttachmentDraft(key, [{ ...a[0], path: "/late.png" }], a);
  expect((await loadAttachmentDraft(key))[0]).toMatchObject({
    drawing,
    name: "annotated.png",
    path: "/late.png",
  });
});

it("moves only captured IDs atomically and preserves other pages on both owners", async () => {
  const from = owner(),
    to = owner();
  await saveAttachmentDraft(from, [image("move"), image("stay")], []);
  await saveAttachmentDraft(to, [image("existing")], []);
  await moveAttachmentDraft(from, to, ["move", "already-deleted"]);
  expect((await loadAttachmentDraft(from)).map((item) => item.id)).toEqual([
    "stay",
  ]);
  expect((await loadAttachmentDraft(to)).map((item) => item.id)).toEqual([
    "existing",
    "move",
  ]);
});

it("rolls back both sides if the destination write fails and permits explicit move retry", async () => {
  const from = owner(),
    to = owner();
  await saveAttachmentDraft(from, [image("move")], []);
  const put = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === to) throw new DOMException("quota", "QuotaExceededError");
      return put.call(this, value, key);
    });
  await expect(moveAttachmentDraft(from, to, ["move"])).rejects.toThrow(
    "quota",
  );
  spy.mockRestore();
  expect((await loadAttachmentDraft(from)).map((item) => item.id)).toEqual([
    "move",
  ]);
  expect(await loadAttachmentDraft(to)).toEqual([]);
  await moveAttachmentDraft(from, to, ["move"]);
  expect(await loadAttachmentDraft(from)).toEqual([]);
  expect((await loadAttachmentDraft(to)).map((item) => item.id)).toEqual([
    "move",
  ]);
});
