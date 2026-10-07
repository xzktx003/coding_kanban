import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useImageAttachments } from "./useImageAttachments";
vi.mock("@session/browser-dialog", () => ({ uploadBrowserFile: vi.fn() }));
import { uploadBrowserFile } from "@session/browser-dialog";

const paste = (file?: File) => ({
  preventDefault: vi.fn(),
  clipboardData: { files: file ? [file] : [], items: [] },
});
test("text paste is left native; image upload blocks send and can be removed", async () => {
  const { result } = renderHook(() => useImageAttachments("codex:test"));
  const text = paste();
  act(() => result.current.onPaste(text as never));
  expect(text.preventDefault).not.toHaveBeenCalled();
  let resolve!: (path: string) => void;
  vi.mocked(uploadBrowserFile).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const event = paste(new File(["image"], "shot.png", { type: "image/png" }));
  await act(async () => result.current.onPaste(event as never));
  await waitFor(() => expect(result.current.attachments).toHaveLength(1));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(result.current.blocked).toBe(true);
  await act(async () => resolve("/uploaded/shot.png"));
  expect(result.current.paths).toEqual(["/uploaded/shot.png"]);
  act(() => result.current.remove(result.current.attachments[0].id));
  expect(result.current.paths).toEqual([]);
});
test("late uploads remain with the originating draft; failure is retryable", async () => {
  let resolve!: (path: string) => void;
  vi.mocked(uploadBrowserFile).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { result, rerender } = renderHook(
    ({ key }) => useImageAttachments(key),
    { initialProps: { key: "cc:a" } },
  );
  await act(async () =>
    result.current.onPaste(
      paste(new File(["x"], "a.png", { type: "image/png" })) as never,
    ),
  );
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  rerender({ key: "cc:b" });
  await act(async () => resolve("/a.png"));
  expect(result.current.paths).toEqual([]);
  rerender({ key: "cc:a" });
  expect(result.current.paths).toEqual(["/a.png"]);
  vi.mocked(uploadBrowserFile).mockRejectedValueOnce(
    new Error("network failed"),
  );
  await act(async () =>
    result.current.onPaste(
      paste(new File(["x"], "b.png", { type: "image/png" })) as never,
    ),
  );
  await waitFor(() =>
    expect(result.current.attachments.some((a) => a.status === "error")).toBe(
      true,
    ),
  );
  expect(result.current.blocked).toBe(true);
  const failed = result.current.attachments.find((a) => a.status === "error")!;
  vi.mocked(uploadBrowserFile).mockResolvedValueOnce("/b.png");
  await act(async () => result.current.retry(failed.id));
  expect(result.current.paths).toEqual(["/a.png", "/b.png"]);
});
