import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { composerDrafts, useComposerDraftStore } from "./v2/drafts";
import { useComposerFileDrop } from "./composerDrop";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const textFile = (name: string, text: string, type = "") =>
  ({
    name,
    type,
    size: text.length,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as File;
const event = (
  files: File[] = [],
  types = files.length ? ["Files"] : ["text/plain"],
) => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  dataTransfer: { files, types, items: [], dropEffect: "none" },
});
beforeEach(() => {
  useComposerDraftStore.setState({ drafts: {}, error: null });
  localStorage.clear();
  vi.clearAllMocks();
});
it("leaves text and session-tab drags native", () => {
  const { result } = renderHook(() =>
    useComposerFileDrop("a", { addImages: vi.fn(), disabled: false }),
  );
  for (const types of [["text/plain"], ["application/x-session-tab"]]) {
    const e = event([], types);
    act(() => {
      result.current.onDragOver(e as never);
      result.current.onDrop(e as never);
    });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  }
});
it("splits image uploads from persistent text snapshots without changing body text or sending", async () => {
  const addImages = vi.fn();
  const { result } = renderHook(() =>
    useComposerFileDrop("a", { addImages, disabled: false }),
  );
  const image = textFile("shot.png", "image bytes", "image/png"),
    file = textFile("main.py", "print('你好')\n");
  const e = event([image, file]);
  await act(async () => result.current.onDrop(e as never));
  await waitFor(() =>
    expect(composerDrafts.read("a").contexts).toHaveLength(1),
  );
  expect(addImages).toHaveBeenCalledExactlyOnceWith([image]);
  expect(composerDrafts.read("a").contexts[0]).toMatchObject({
    kind: "file",
    name: "main.py",
    text: "print('你好')\n",
  });
  expect(composerDrafts.read("a").contexts[0].path).toBeUndefined();
  expect(localStorage.getItem("kanban.session.composer-v2")).toContain(
    "main.py",
  );
  expect(e.preventDefault).toHaveBeenCalledOnce();
  expect(e.stopPropagation).toHaveBeenCalledOnce();
});
it("a late local file read belongs to its captured owner and does not block another draft", async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const file = {
    name: "slow.md",
    type: "text/markdown",
    size: 4,
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((r) => {
        resolve = r;
      }),
  } as File;
  const { result, rerender } = renderHook(
    ({ owner }) =>
      useComposerFileDrop(owner, { addImages: vi.fn(), disabled: false }),
    { initialProps: { owner: "a" } },
  );
  act(() => result.current.onDrop(event([file]) as never));
  expect(result.current.pending).toBe(true);
  rerender({ owner: "b" });
  expect(result.current.pending).toBe(false);
  await act(async () => resolve(new TextEncoder().encode("完整快照").buffer));
  expect(composerDrafts.read("b").contexts).toHaveLength(0);
  expect(composerDrafts.read("a").contexts[0].text).toBe("完整快照");
  rerender({ owner: "a" });
  expect(result.current.pending).toBe(false);
});
it("reports binary, malformed UTF-8 and oversized text instead of attaching corrupt content", async () => {
  const addImages = vi.fn(),
    readLarge = vi.fn();
  const { result } = renderHook(() =>
    useComposerFileDrop("a", { addImages, disabled: false }),
  );
  const badUtf8 = {
    name: "bad.bin",
    type: "",
    size: 2,
    arrayBuffer: async () => new Uint8Array([255, 254]).buffer,
  } as File;
  const tooLarge = {
    name: "large.txt",
    type: "text/plain",
    size: 11 * 1024 * 1024,
    arrayBuffer: readLarge,
  } as unknown as File;
  await act(async () =>
    result.current.onDrop(
      event([
        textFile("binary.bin", "a\0b"),
        badUtf8,
        tooLarge,
        textFile("long.md", "x".repeat(180001)),
      ]) as never,
    ),
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(composerDrafts.read("a").contexts).toHaveLength(0);
  expect(toast.error).toHaveBeenCalledTimes(4);
  expect(readLarge).not.toHaveBeenCalled();
  expect(addImages).not.toHaveBeenCalled();
});
it("clears file hover after drop and never accepts attachments for a blocked child", () => {
  const addImages = vi.fn();
  const { result, rerender } = renderHook(
    ({ disabled }) => useComposerFileDrop("a", { addImages, disabled }),
    { initialProps: { disabled: false } },
  );
  const drag = event([], ["Files"]);
  act(() => result.current.onDragOver(drag as never));
  expect(result.current.active).toBe(true);
  expect(drag.dataTransfer.dropEffect).toBe("copy");
  rerender({ disabled: true });
  const drop = event([textFile("a.png", "x", "image/png")]);
  act(() => result.current.onDrop(drop as never));
  expect(drop.preventDefault).toHaveBeenCalledOnce();
  expect(addImages).not.toHaveBeenCalled();
  expect(result.current.active).toBe(false);
  expect(composerDrafts.read("a").contexts).toHaveLength(0);
});
it("keeps dropped file selection order when reading the first file is slower", async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const slow = {
    name: "first.md",
    size: 4,
    type: "",
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((r) => {
        resolve = r;
      }),
  } as File;
  const { result } = renderHook(() =>
    useComposerFileDrop("a", { addImages: vi.fn(), disabled: false }),
  );
  act(() =>
    result.current.onDrop(
      event([slow, textFile("second.md", "second")]) as never,
    ),
  );
  await act(async () => resolve(new TextEncoder().encode("first").buffer));
  expect(composerDrafts.read("a").contexts.map((c) => c.name)).toEqual([
    "first.md",
    "second.md",
  ]);
});
it("does not restore an obsolete hover after switching away and back to a draft", () => {
  const { result, rerender } = renderHook(
    ({ owner }) =>
      useComposerFileDrop(owner, { addImages: vi.fn(), disabled: false }),
    { initialProps: { owner: "a" } },
  );
  act(() => result.current.onDragOver(event([], ["Files"]) as never));
  expect(result.current.active).toBe(true);
  rerender({ owner: "b" });
  rerender({ owner: "a" });
  expect(result.current.active).toBe(false);
});
