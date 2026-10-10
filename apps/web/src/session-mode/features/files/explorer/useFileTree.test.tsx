import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useFileTree } from "./useFileTree";

const api = vi.hoisted(() => ({
  canonicalizePath: vi.fn(async (path: string) => path),
  readDirectory: vi.fn(),
  searchFilesByName: vi.fn(async () => []),
}));
const settingsState = vi.hoisted(() => ({ hiddenNames: [] as string[] }));
const watchState = vi.hoisted(() => ({
  onChange: null as ((event: { path: string; kind: string }) => void) | null,
}));

vi.mock("@session/services/apiAdapt", () => api);
vi.mock("@session/hooks/useDirWatch", () => ({
  useDirWatch: (
    _path: string | null,
    onChange: (event: { path: string; kind: string }) => void,
  ) => {
    watchState.onChange = onChange;
  },
}));
vi.mock("@session/stores", () => ({
  useEditorStore: () => ({ selectedFilePath: null }),
}));
vi.mock("@session/stores/settings", () => ({
  useSettingsStore: () => settingsState,
}));

const entriesByPath = new Map<string, unknown[][]>();

const queueEntries = (path: string, responses: unknown[][]) => {
  entriesByPath.set(path, responses);
};

beforeEach(() => {
  api.canonicalizePath.mockClear();
  api.readDirectory.mockReset();
  api.searchFilesByName.mockClear();
  entriesByPath.clear();
  watchState.onChange = null;
  api.readDirectory.mockImplementation(async (path: string) => {
    const queued = entriesByPath.get(path);
    if (!queued?.length) return [];
    return queued.length === 1 ? queued[0] : queued.shift();
  });
});

test("workspace refresh keeps expanded folders open and reloads their children", async () => {
  queueEntries("/project", [
    [
      { name: "src", path: "/project/src", is_dir: true },
      { name: "README.md", path: "/project/README.md", is_dir: false },
    ],
    [
      { name: "src", path: "/project/src", is_dir: true },
      { name: "README.md", path: "/project/README.md", is_dir: false },
    ],
  ]);
  queueEntries("/project/src", [
    [{ name: "before.ts", path: "/project/src/before.ts", is_dir: false }],
    [{ name: "after.ts", path: "/project/src/after.ts", is_dir: false }],
  ]);

  const { result } = renderHook(() => useFileTree("/project"));

  await waitFor(() => expect(result.current.root?.path).toBe("/project"));
  const src = result.current.root?.children?.find(
    (node) => node.path === "/project/src",
  );
  expect(src).toBeTruthy();

  await act(async () => {
    result.current.toggle("/project/src");
    await result.current.loadChildren(src!);
  });
  await waitFor(() =>
    expect(
      result.current.root?.children
        ?.find((node) => node.path === "/project/src")
        ?.children?.map((node) => node.name),
    ).toEqual(["before.ts"]),
  );

  act(() => {
    window.dispatchEvent(
      new CustomEvent("workspace-files-changed", {
        detail: { root: "/project" },
      }),
    );
  });

  await waitFor(() =>
    expect(
      result.current.root?.children
        ?.find((node) => node.path === "/project/src")
        ?.children?.map((node) => node.name),
    ).toEqual(["after.ts"]),
  );
  expect(result.current.activeExpanded.has("/project/src")).toBe(true);
  expect(api.readDirectory).toHaveBeenCalledWith("/project/src");
});

test("expanded folders do not leak across project changes", async () => {
  queueEntries("/project", [
    [{ name: "src", path: "/project/src", is_dir: true }],
  ]);
  queueEntries("/project/src", [[]]);
  queueEntries("/other", [[{ name: "app", path: "/other/app", is_dir: true }]]);

  const { result, rerender } = renderHook(({ folder }) => useFileTree(folder), {
    initialProps: { folder: "/project" },
  });

  await waitFor(() => expect(result.current.root?.path).toBe("/project"));
  const src = result.current.root?.children?.[0];
  await act(async () => {
    result.current.toggle("/project/src");
    await result.current.loadChildren(src!);
  });

  rerender({ folder: "/other" });

  await waitFor(() => expect(result.current.root?.path).toBe("/other"));
  expect([...result.current.activeExpanded]).toEqual(["/other"]);
});

test("sibling paths with a shared prefix do not refresh the tree", async () => {
  queueEntries("/project", [
    [{ name: "src", path: "/project/src", is_dir: true }],
    [{ name: "changed", path: "/project/changed", is_dir: true }],
  ]);

  const { result } = renderHook(() => useFileTree("/project"));

  await waitFor(() => expect(result.current.root?.path).toBe("/project"));
  expect(watchState.onChange).toBeTruthy();
  const readCountBeforeSiblingChange = api.readDirectory.mock.calls.length;

  act(() => {
    watchState.onChange?.({ path: "/project-sibling/new.ts", kind: "create" });
  });

  expect(api.readDirectory).toHaveBeenCalledTimes(readCountBeforeSiblingChange);

  act(() => {
    watchState.onChange?.({ path: "/project/src/new.ts", kind: "create" });
  });

  await waitFor(() =>
    expect(result.current.root?.children?.map((node) => node.name)).toEqual([
      "changed",
    ]),
  );
});
