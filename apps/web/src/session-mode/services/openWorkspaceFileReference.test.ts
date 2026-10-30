import { beforeEach, expect, it, vi } from "vitest";
import { openWorkspaceFileReference } from "./openWorkspaceFileReference";
import { resolveWorkspaceFileReference } from "./workspaceFiles";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
vi.mock("./workspaceFiles", () => ({ resolveWorkspaceFileReference: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  useEditorStore.getState().resetFiles();
  useLayoutStore.setState({ isRightPanelOpen: false });
});
it("opens the real file in its registered project and keeps the citation range", async () => {
  const onOpened = vi.fn();
  vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({
    root: "/quanttool",
    path: "/quanttool/xhquant/operator.py",
  });
  await openWorkspaceFileReference(
    { path: "/modelzoo/xhquant/operator.py", line: 42, column: 3, endLine: 45 },
    "/modelzoo",
    onOpened,
  );
  expect(onOpened).toHaveBeenCalledWith({
    root: "/quanttool",
    path: "/quanttool/xhquant/operator.py",
  });
  expect(resolveWorkspaceFileReference).toHaveBeenCalledWith(
    "/modelzoo",
    "/modelzoo/xhquant/operator.py",
  );
  expect(
    useEditorStore.getState().roots["/quanttool/xhquant/operator.py"],
  ).toBe("/quanttool");
  expect(useEditorStore.getState().revealLocation).toMatchObject({
    path: "/quanttool/xhquant/operator.py",
    line: 42,
    column: 3,
    endLine: 45,
  });
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
});
it("leaves the current file and panel untouched when resolution is rejected", async () => {
  vi.mocked(resolveWorkspaceFileReference).mockRejectedValue(
    new Error("文件链接目标未注册"),
  );
  useEditorStore.getState().openFile("/original/file", "/original");
  expect(
    await openWorkspaceFileReference({ path: "/modelzoo/link" }, "/modelzoo"),
  ).toBe(false);
  expect(useEditorStore.getState().activeFile).toBe("/original/file");
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(false);
});
it("a late result cannot replace a more recent click", async () => {
  const onOpened = vi.fn();
  let done!: (target: { root: string; path: string }) => void;
  vi.mocked(resolveWorkspaceFileReference)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    )
    .mockResolvedValueOnce({ root: "/repo", path: "/repo/second" });
  const first = openWorkspaceFileReference({ path: "/repo/first" }, "/repo", onOpened);
  await openWorkspaceFileReference({ path: "/repo/second" }, "/repo");
  done({ root: "/repo", path: "/repo/first" });
  expect(await first).toBe(false);
  expect(onOpened).not.toHaveBeenCalled();
  expect(useEditorStore.getState().activeFile).toBe("/repo/second");
});
it("does not override a file selected while resolution was pending", async () => {
  let done!: (target: { root: string; path: string }) => void;
  vi.mocked(resolveWorkspaceFileReference).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const pending = openWorkspaceFileReference({ path: "/repo/link" }, "/repo");
  useEditorStore.getState().openFile("/repo/manual", "/repo");
  done({ root: "/repo", path: "/repo/real" });
  expect(await pending).toBe(false);
  expect(useEditorStore.getState().activeFile).toBe("/repo/manual");
});
it("rejects malformed resolve responses and unknown owners before opening", async () => {
  vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({
    root: "/repo",
    path: "/outside/file",
  });
  expect(
    await openWorkspaceFileReference({ path: "/repo/link" }, "/repo"),
  ).toBe(false);
  expect(await openWorkspaceFileReference({ path: "/repo/link" })).toBe(false);
  expect(useEditorStore.getState().openFiles).toEqual([]);
  expect(resolveWorkspaceFileReference).toHaveBeenCalledTimes(1);
});
it("does not reveal a late old-runtime file or toast after account authority changes",async()=>{let done!:(target:{root:string;path:string})=>void;vi.mocked(resolveWorkspaceFileReference).mockReturnValueOnce(new Promise(resolve=>done=resolve));const onOpened=vi.fn(),pending=openWorkspaceFileReference({path:"/repo/file"},"/repo",onOpened);const {invalidateCodexOperationScope}=await import("./codexOperationScope");invalidateCodexOperationScope();done({root:"/repo",path:"/repo/file"});expect(await pending).toBe(false);expect(onOpened).not.toHaveBeenCalled();expect(useEditorStore.getState().activeFile).toBeNull();});
