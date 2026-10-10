import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
const storage = vi.hoisted(() => ({
  loadAttachmentDraft: vi.fn(),
  saveAttachmentDraft: vi.fn(),
}));
vi.mock("@session/services/sessionAttachmentStorage", () => storage);
vi.mock("@session/browser-dialog", () => ({ uploadBrowserFile: vi.fn() }));
import { uploadBrowserFile } from "@session/browser-dialog";
import {
  flushAttachmentDraft,
  useAttachmentDraftStore,
  useImageAttachments,
} from "./useImageAttachments";

beforeEach(() => {
  vi.resetAllMocks();
  useAttachmentDraftStore.setState({ drafts: {}, hydrated: {}, errors: {} });
  storage.loadAttachmentDraft.mockResolvedValue([]);
  storage.saveAttachmentDraft.mockResolvedValue(undefined);
});

test("a failed persistent read never overwrites unread drafts; explicit recovery restores attachments", async () => {
  storage.loadAttachmentDraft.mockRejectedValueOnce(
    new Error("storage temporarily unavailable"),
  );
  const owner = `read-error:${crypto.randomUUID()}`;
  const { result } = renderHook(() => useImageAttachments(owner));
  await waitFor(() =>
    expect(result.current.storageError).toBe("storage temporarily unavailable"),
  );
  expect(storage.saveAttachmentDraft).not.toHaveBeenCalled();
  expect(result.current.blocked).toBe(true);
  storage.loadAttachmentDraft.mockResolvedValue([
    {
      id: "saved",
      name: "saved.png",
      path: "/saved.png",
      preview: "",
      status: "ready",
    },
  ]);
  await act(async () => result.current.retryStorage());
  expect(result.current.paths).toEqual(["/saved.png"]);
  expect(result.current.storageError).toBeUndefined();
});

test("a quota failure keeps local file bytes, blocks upload, and permits retry after storage recovers", async () => {
  storage.saveAttachmentDraft.mockRejectedValue(new Error("quota exhausted"));
  const owner = `quota:${crypto.randomUUID()}`;
  const { result } = renderHook(() => useImageAttachments(owner));
  const file = new File(["local bytes"], "unsaved.png", { type: "image/png" });
  act(() => result.current.addFiles([file]));
  await waitFor(() =>
    expect(result.current.attachments[0]?.status).toBe("error"),
  );
  expect(result.current.attachments[0].file).toBe(file);
  expect(uploadBrowserFile).not.toHaveBeenCalled();
  expect(result.current.blocked).toBe(true);
  storage.saveAttachmentDraft.mockResolvedValue(undefined);
  vi.mocked(uploadBrowserFile).mockResolvedValue("/saved-after-recovery.png");
  await act(async () => result.current.retry(result.current.attachments[0].id));
  expect(result.current.paths).toEqual(["/saved-after-recovery.png"]);
});

test("a persistence failure blocks ready path attachments until storage is saved", async () => {
  const owner = `ready-quota:${crypto.randomUUID()}`;
  const { result } = renderHook(() => useImageAttachments(owner));
  await waitFor(() => expect(result.current.blocked).toBe(false));
  storage.saveAttachmentDraft.mockRejectedValue(new Error("quota"));
  act(() => result.current.addPaths(["/ready.png"]));
  await waitFor(() => expect(result.current.storageError).toBe("quota"));
  expect(result.current.blocked).toBe(true);
});
test("removing a photo while its bytes are being saved prevents a later upload", async () => {
  const owner = `remove-before-upload:${crypto.randomUUID()}`;
  const { result } = renderHook(() => useImageAttachments(owner));
  await waitFor(() => expect(result.current.blocked).toBe(false));
  let release!: () => void;
  storage.saveAttachmentDraft.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  vi.mocked(uploadBrowserFile).mockResolvedValue("/removed.png");
  act(() =>
    result.current.addFiles([
      new File(["private local bytes"], "removed.png", { type: "image/png" }),
    ]),
  );
  await waitFor(() => expect(release).toBeTypeOf("function"));
  act(() => result.current.remove(result.current.attachments[0].id));
  await act(async () => release());
  await act(async () => flushAttachmentDraft(owner));
  expect(result.current.attachments).toHaveLength(0);
  expect(uploadBrowserFile).not.toHaveBeenCalled();
});
