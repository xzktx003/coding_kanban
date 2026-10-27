import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  loadAttachmentDraft,
  saveAttachmentDraft,
} from "@session/services/sessionAttachmentStorage";
import {
  ensureAttachmentDraft,
  flushAttachmentDraft,
  moveImageDraft,
  useImageAttachments,
} from "./useImageAttachments";
vi.mock("@session/browser-dialog", () => ({ uploadBrowserFile: vi.fn() }));
import { uploadBrowserFile } from "@session/browser-dialog";
afterEach(() => vi.restoreAllMocks());

test("the hook clears submitted IDs without deleting another page's newly persisted file", async () => {
  const owner = `hook-pages:${crypto.randomUUID()}`;
  const { result } = renderHook(() => useImageAttachments(owner));
  await act(async () => ensureAttachmentDraft(owner));
  act(() => result.current.addPaths(["/submitted.png"]));
  await act(async () => flushAttachmentDraft(owner));
  const snapshot = await loadAttachmentDraft(owner);
  await saveAttachmentDraft(
    owner,
    [
      ...snapshot,
      {
        id: "other-page",
        name: "new.png",
        file: new File(["retain bytes"], "new.png"),
        preview: "",
        status: "error",
      },
    ],
    snapshot,
  );
  act(() => result.current.clear(snapshot.map((item) => item.id)));
  await act(async () => flushAttachmentDraft(owner));
  const stored = await loadAttachmentDraft(owner);
  expect(stored.map((item) => item.id)).toEqual(["other-page"]);
  expect(stored[0].file?.size).toBe(12);
});

test("a remote removal also removes the local stale preview after the pending upload finishes", async () => {
  const owner = `hook-upload:${crypto.randomUUID()}`;
  let release!: (path: string) => void;
  vi.mocked(uploadBrowserFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { result } = renderHook(() => useImageAttachments(owner));
  await act(async () => ensureAttachmentDraft(owner));
  act(() =>
    result.current.addFiles([
      new File(["photo"], "photo.png", { type: "image/png" }),
    ]),
  );
  await waitFor(() => expect(release).toBeTypeOf("function"));
  const otherPage = await loadAttachmentDraft(owner);
  await saveAttachmentDraft(owner, [], otherPage);
  await act(async () => release("/late.png"));
  await act(async () => flushAttachmentDraft(owner));
  expect(result.current.attachments).toEqual([]);
  expect(await loadAttachmentDraft(owner)).toEqual([]);
});

test.each(["source", "destination"])(
  "a failed %s save during creation preserves files and retry finishes the atomic move",
  async (failureAt) => {
    const from = `hook-move:${crypto.randomUUID()}`,
      to = `${from}:created`;
    const source = renderHook(() => useImageAttachments(from));
    await act(async () => ensureAttachmentDraft(from));
    const put = IDBObjectStore.prototype.put;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        if (key === (failureAt === "source" ? from : to))
          throw new DOMException("quota", "QuotaExceededError");
        return put.call(this, value, key);
      });
    act(() => source.result.current.addPaths(["/keep.png"]));
    await act(async () => {
      await expect(moveImageDraft(from, to)).rejects.toThrow("quota");
    });
    const target = renderHook(() => useImageAttachments(to));
    expect(target.result.current.paths).toEqual(["/keep.png"]);
    expect(target.result.current.blocked).toBe(true);
    if (failureAt === "destination")
      expect(
        (await loadAttachmentDraft(from)).map((item) => item.path),
      ).toEqual(["/keep.png"]);
    expect(await loadAttachmentDraft(to)).toEqual([]);
    spy.mockRestore();
    await act(async () => target.result.current.retryStorage());
    expect(target.result.current.paths).toEqual(["/keep.png"]);
    expect(target.result.current.blocked).toBe(false);
    expect(await loadAttachmentDraft(from)).toEqual([]);
    expect((await loadAttachmentDraft(to)).map((item) => item.path)).toEqual([
      "/keep.png",
    ]);
  },
);
