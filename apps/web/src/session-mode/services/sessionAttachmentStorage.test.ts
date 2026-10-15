import { afterEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  loadAttachmentDraft,
  saveAttachmentDraft,
} from "./sessionAttachmentStorage";
import {
  useAttachmentDraftStore,
  useImageAttachments,
} from "../components/common/useImageAttachments";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
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

it("reports a hanging initial database open and retries without losing unread attachments", async () => {
  const owner = `open-timeout:${crypto.randomUUID()}`;
  await saveAttachmentDraft(owner, [
    {
      id: "saved",
      name: "saved.png",
      path: "/saved.png",
      preview: "",
      status: "ready",
    },
  ]);
  vi.useFakeTimers();
  const lateDatabase = { close: vi.fn(), transaction: vi.fn() };
  const request = { result: lateDatabase } as unknown as IDBOpenDBRequest;
  const open = vi.spyOn(indexedDB, "open").mockReturnValueOnce(request);
  const { result } = renderHook(() => useImageAttachments(owner));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(result.current.storageError).toContain("超时");
  expect(result.current.blocked).toBe(true);
  expect(useAttachmentDraftStore.getState().hydrated[owner]).not.toBe(true);
  expect(result.current.attachments).toEqual([]);

  open.mockRestore();
  vi.useRealTimers();
  await act(async () => result.current.retryStorage());
  expect(result.current.paths).toEqual(["/saved.png"]);
  expect(result.current.storageError).toBeUndefined();
  expect(result.current.blocked).toBe(false);
  const restored = useAttachmentDraftStore.getState();
  await act(async () => request.onsuccess?.call(request, new Event("success")));
  expect(lateDatabase.close).toHaveBeenCalledOnce();
  expect(lateDatabase.transaction).not.toHaveBeenCalled();
  expect(useAttachmentDraftStore.getState()).toBe(restored);
  expect((await loadAttachmentDraft(owner))[0].id).toBe("saved");
});

it.each(["readonly", "readwrite"] as const)(
  "aborts a hanging %s transaction and closes the connection on timeout",
  async (mode) => {
    vi.useFakeTimers();
    const transaction = {
      abort: vi.fn(),
      objectStore: () => ({
        get: () => ({ result: [] }),
        delete: () => ({ result: undefined }),
      }),
    } as unknown as IDBTransaction;
    const database = { transaction: vi.fn(() => transaction), close: vi.fn() };
    const request = { result: database } as unknown as IDBOpenDBRequest;
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      queueMicrotask(() =>
        request.onsuccess?.call(request, new Event("success")),
      );
      return request;
    });
    const outcome: { settled: boolean; error?: Error } = { settled: false };
    void (
      mode === "readonly"
        ? loadAttachmentDraft("read")
        : saveAttachmentDraft("write", [])
    ).then(
      () => {
        outcome.settled = true;
      },
      (error) => Object.assign(outcome, { settled: true, error }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(outcome.settled).toBe(true);
    expect(outcome.error?.message).toContain("超时");
    expect(transaction.abort).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  },
);

it("expires stuck file-byte preparation so retry can read again and a late save cannot overwrite it", async () => {
  const owner = `bytes-timeout:${crypto.randomUUID()}`;
  const file = new File(["photo"], "photo.png", { type: "image/png" });
  let resolveBytes!: (bytes: ArrayBuffer) => void;
  const arrayBuffer = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveBytes = resolve;
        }),
    )
    .mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  Object.defineProperty(file, "arrayBuffer", { value: arrayBuffer });
  const item = {
    id: "old",
    name: file.name,
    file,
    preview: "",
    status: "uploading" as const,
  };
  vi.useFakeTimers();
  const outcome: { settled: boolean; error?: Error } = { settled: false };
  void saveAttachmentDraft(owner, [item]).then(
    () => {
      outcome.settled = true;
    },
    (error) => Object.assign(outcome, { settled: true, error }),
  );
  await vi.advanceTimersByTimeAsync(10_000);
  expect(outcome.settled).toBe(true);
  expect(outcome.error?.message).toContain("超时");
  vi.useRealTimers();
  await saveAttachmentDraft(owner, [{ ...item, id: "retried" }]);
  expect(arrayBuffer).toHaveBeenCalledTimes(2);
  resolveBytes(new Uint8Array([9]).buffer);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((await loadAttachmentDraft(owner))[0].id).toBe("retried");
});
