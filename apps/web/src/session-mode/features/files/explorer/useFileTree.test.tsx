import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useFileTree } from "./useFileTree";
import { FileTree } from "./FileTree";
import type { FileNode } from "./types";

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

vi.mock("./FileTreeNode", () => ({
  FileTreeNode: function Row({
    node,
    activeExpanded,
    onToggle,
    onLoadChildren,
    onFileSelect,
  }: {
    node: FileNode;
    activeExpanded: Set<string>;
    onToggle: (path: string) => void;
    onLoadChildren: (node: FileNode) => void;
    onFileSelect?: (path: string) => void;
  }) {
    return (
      <div>
        <button
          onClick={() => {
            if (node.kind === "dir") {
              onToggle(node.path);
              onLoadChildren(node);
            } else onFileSelect?.(node.path);
          }}
        >
          {node.name}
        </button>
        {activeExpanded.has(node.path) &&
          node.children?.map((child) => (
            <Row
              key={child.path}
              node={child}
              activeExpanded={activeExpanded}
              onToggle={onToggle}
              onLoadChildren={onLoadChildren}
              onFileSelect={onFileSelect}
            />
          ))}
      </div>
    );
  },
}));

const rootEntries = [{ name: "src", path: "/project/src", is_dir: true }];
const childEntries = [
  { name: "keep.ts", path: "/project/src/keep.ts", is_dir: false },
];

async function expandedTree() {
  queueEntries("/project", [rootEntries]);
  queueEntries("/project/src", [childEntries]);
  const select = vi.fn();
  const view = render(<FileTree folder="/project" onFileSelect={select} />);
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  const row = await screen.findByRole("button", { name: "keep.ts" });
  const viewport =
    view.container.querySelector<HTMLElement>(".overflow-y-auto")!;
  viewport.scrollTop = 120;
  row.focus();
  return { view, viewport, row, select };
}

test.each(["create", "remove"])(
  "%s refresh keeps the same tree, scroll, focus and expanded directories",
  async (kind) => {
    const { view, viewport, row } = await expandedTree();
    let resolve!: (entries: unknown[]) => void;
    api.readDirectory.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() => watchState.onChange?.({ path: "/project/new.ts", kind }));
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    expect(view.container.contains(row)).toBe(true);
    expect(view.container.querySelector(".overflow-y-auto")).toBe(viewport);
    expect(document.activeElement).toBe(row);
    expect(viewport.scrollTop).toBe(120);
    await act(async () => resolve(rootEntries));
    await waitFor(() =>
      expect(api.readDirectory).toHaveBeenLastCalledWith("/project/src"),
    );
    expect(screen.getByRole("button", { name: "keep.ts" })).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(viewport.scrollTop).toBe(120);
  },
);

test.each(["root", "expanded directory"])(
  "failed %s background refresh retains usable files and supports retry",
  async (failure) => {
    const { view, viewport, row, select } = await expandedTree();
    if (failure === "expanded directory")
      api.readDirectory.mockResolvedValueOnce(rootEntries);
    api.readDirectory.mockRejectedValueOnce(new Error("refresh unavailable"));
    act(() =>
      watchState.onChange?.({ path: "/project/new.ts", kind: "create" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "refresh unavailable",
    );
    expect(view.container.contains(row)).toBe(true);
    expect(document.activeElement).toBe(row);
    expect(viewport.scrollTop).toBe(120);
    fireEvent.click(row);
    expect(select).toHaveBeenCalledWith("/project/src/keep.ts");
    fireEvent.click(screen.getByRole("button", { name: "重新加载文件树" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: "keep.ts" })).toBe(row);
  },
);

test("switching project hides old files while the new tree is pending or fails", async () => {
  const { view, row } = await expandedTree();
  let reject!: (error: Error) => void;
  api.readDirectory.mockImplementationOnce(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      }),
  );
  view.rerender(<FileTree folder="/other" />);
  expect(view.container.contains(row)).toBe(false);
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  await act(async () => reject(new Error("new project unavailable")));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "new project unavailable",
  );
  expect(screen.queryByRole("button", { name: "keep.ts" })).toBeNull();
});
