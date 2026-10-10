import { afterEach, expect, it, vi } from "vitest";
import {
  loadAttachmentDraft,
  saveAttachmentDraft,
} from "./sessionAttachmentStorage";

afterEach(() => vi.restoreAllMocks());
it("persists the original annotated photo as portable bytes and restores its editable drawing", async () => {
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (
      value.some(
        (item: any) =>
          item.file instanceof File ||
          item.drawing?.originalFile instanceof File,
      )
    )
      throw new DOMException("Error preparing Blob/File data", "UnknownError");
    return put.call(this, value, key);
  });
  const original = new File([new Uint8Array([1, 2, 255])], "original.png", {
    type: "image/png",
    lastModified: 5678,
  });
  const annotated = new File([new Uint8Array([3, 4, 254])], "标注图片.png", {
    type: "image/png",
    lastModified: 6789,
  });
  const document = {
    version: 1 as const,
    width: 200,
    height: 160,
    marks: [
      {
        id: "mark",
        kind: "pen" as const,
        points: [{ x: 20, y: 30 }],
        color: "#ff0000",
        width: 2,
      },
    ],
  };
  const owner = `webkit-annotation:${crypto.randomUUID()}`;
  await saveAttachmentDraft(owner, [
    {
      id: "annotation",
      name: annotated.name,
      file: annotated,
      preview: "blob:temporary",
      status: "ready",
      drawing: {
        document,
        originalFile: original,
        originalPath: "/fixture/original.png",
      },
    },
  ]);
  const saved = (await loadAttachmentDraft(owner))[0];
  expect(saved.drawing?.document).toEqual(document);
  expect(saved.drawing?.originalPath).toBe("/fixture/original.png");
  expect(saved.drawing?.originalFile).toBeInstanceOf(File);
  expect(saved.drawing?.originalFile!.name).toBe("original.png");
  expect(saved.drawing?.originalFile!.lastModified).toBe(5678);
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(saved.drawing!.originalFile!);
  });
  expect([...new Uint8Array(bytes)]).toEqual([1, 2, 255]);
});
it("persists photo-picker bytes even when IndexedDB cannot store a File and restores an identical retryable file", async () => {
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (value.some((item: any) => item.file instanceof File))
      throw new DOMException(
        "Error preparing Blob/File data to be stored in object store",
        "UnknownError",
      );
    return put.call(this, value, key);
  });
  const bytes = new Uint8Array([0, 255, 12, 128, 64]);
  const file = new File([bytes], "手机截图.png", {
    type: "image/png",
    lastModified: 1234,
  });
  const owner = `webkit-picker:${crypto.randomUUID()}`;
  await saveAttachmentDraft(owner, [
    {
      id: "photo",
      name: file.name,
      preview: "blob:temporary",
      status: "uploading",
      file,
    },
  ]);
  const saved = (await loadAttachmentDraft(owner))[0];
  expect(saved.preview).toBe("");
  expect(saved.file).toBeInstanceOf(File);
  expect(saved.file!.name).toBe("手机截图.png");
  expect(saved.file!.type).toBe("image/png");
  expect(saved.file!.lastModified).toBe(1234);
  const restoredBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(saved.file!);
  });
  expect(Array.from(new Uint8Array(restoredBytes))).toEqual(Array.from(bytes));
  expect(saved.status).toBe("uploading");
  expect(saved.id).toBe("photo");
});
it("keeps uploaded path-only metadata and drawings across the portable format", async () => {
  const owner = `path-only:${crypto.randomUUID()}`;
  const drawing = {
    document: { version: 1 as const, width: 120, height: 80, marks: [] },
    originalPath: "/saved.png",
  };
  await saveAttachmentDraft(owner, [
    {
      id: "saved",
      name: "saved.png",
      path: "/saved.png",
      preview: "blob:stale",
      status: "ready",
      drawing,
    },
  ]);
  expect((await loadAttachmentDraft(owner))[0]).toEqual({
    id: "saved",
    name: "saved.png",
    path: "/saved.png",
    preview: "",
    status: "ready",
    drawing,
  });
  await saveAttachmentDraft(owner, []);
  expect(await loadAttachmentDraft(owner)).toEqual([]);
});
