import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  ensureAttachmentDraft,
  flushAttachmentDraft,
  moveImageDraft,
  useAttachmentDraftStore,
  useImageAttachments,
} from "./useImageAttachments";
import { loadAttachmentDraft } from "@session/services/sessionAttachmentStorage";
vi.mock("@session/browser-dialog", () => ({ uploadBrowserFile: vi.fn() }));
import { uploadBrowserFile } from "@session/browser-dialog";

beforeEach(() => {
  vi.resetAllMocks();
  useAttachmentDraftStore.setState({ drafts: {}, hydrated: {}, errors: {} });
});

test("uploaded metadata survives memory reset and reload, with no stale blob URL", async () => {
  const owner = `persist:${crypto.randomUUID()}`;
  const { result, unmount } = renderHook(() => useImageAttachments(owner));
  await act(async () => ensureAttachmentDraft(owner));
  act(() => result.current.addPaths(["/uploaded/saved.png"]));
  await act(async () => flushAttachmentDraft(owner));
  const saved = await loadAttachmentDraft(owner);
  expect(saved[0]).toMatchObject({
    path: "/uploaded/saved.png",
    preview: "",
    status: "ready",
  });
  unmount();
  useAttachmentDraftStore.setState({ drafts: {}, hydrated: {}, errors: {} });
  const restored = renderHook(() => useImageAttachments(owner));
  await waitFor(() =>
    expect(restored.result.current.paths).toEqual(["/uploaded/saved.png"]),
  );
  expect(restored.result.current.blocked).toBe(false);
  act(() =>
    restored.result.current.remove(restored.result.current.attachments[0].id),
  );
  await act(async () => flushAttachmentDraft(owner));
  expect(await loadAttachmentDraft(owner)).toEqual([]);
});

test("creation moves attachments to the created session; clearing submitted IDs preserves later attachments", async () => {
  const from = `new:${crypto.randomUUID()}`,
    to = `session:${crypto.randomUUID()}`;
  const { result } = renderHook(() => useImageAttachments(from));
  await act(async () => ensureAttachmentDraft(from));
  act(() => result.current.addPaths(["/first.png"]));
  const submitted = result.current.attachments.map((item) => item.id);
  await act(async () => moveImageDraft(from, to));
  const target = renderHook(() => useImageAttachments(to));
  act(() => target.result.current.addPaths(["/later.png"]));
  act(() => result.current.clear(submitted));
  expect(target.result.current.paths).toEqual(["/later.png"]);
  await act(async () =>
    Promise.all([flushAttachmentDraft(from), flushAttachmentDraft(to)]),
  );
  expect(await loadAttachmentDraft(from)).toEqual([]);
  expect((await loadAttachmentDraft(to)).map((item) => item.path)).toEqual([
    "/later.png",
  ]);
});

test("a late upload follows its attachment to the created session and cannot reappear after removal", async () => {
  const from = `late:${crypto.randomUUID()}`,
    to = `created:${crypto.randomUUID()}`;
  let finish!: (path: string) => void;
  vi.mocked(uploadBrowserFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useImageAttachments(from));
  await act(async () => ensureAttachmentDraft(from));
  act(() =>
    result.current.addFiles([
      new File(["fixture"], "pending.png", { type: "image/png" }),
    ]),
  );
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  const ids = result.current.attachments.map((item) => item.id);
  await act(async () => moveImageDraft(from, to));
  const target = renderHook(() => useImageAttachments(to));
  act(() => target.result.current.clear(ids));
  await act(async () => finish("/uploaded/late.png"));
  expect(result.current.paths).toEqual([]);
  expect(target.result.current.attachments).toEqual([]);
  await act(async () => flushAttachmentDraft(to));
  expect(await loadAttachmentDraft(to)).toEqual([]);
});
