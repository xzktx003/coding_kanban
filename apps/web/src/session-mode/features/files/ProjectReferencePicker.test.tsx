import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }));
vi.mock("./projectReferences", async (original) => ({ ...await original<typeof import("./projectReferences")>(), listProjectReferences: calls.list, readProjectReference: calls.read }));
import { ProjectReferencePicker } from "./ProjectReferencePicker";
import { referenceContext } from "./projectReferences";
import { resetGoalCompletionScope } from "@session/services/goalCompletionAutoClear";
const snapshot = { root: "/project", path: "/project/folder", kind: "directory" as const, content: "a.txt\nchild/", version: "a".repeat(64), truncated: false };
beforeEach(() => {
  vi.clearAllMocks();
  calls.list.mockResolvedValue({ root: "/project", path: "/project", entries: [{ kind: "directory", name: "folder", path: "/project/folder" }], truncated: false });
  calls.read.mockResolvedValue(snapshot);
});
afterEach(cleanup);
it("keeps canonical directory identity and frozen one-level content in the normal draft context", async () => {
  const select = vi.fn(), close = vi.fn();
  render(<ProjectReferencePicker owner="codex:one" root="/project" onSelect={select} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "引用目录 folder" }));
  await waitFor(() => expect(select).toHaveBeenCalledOnce());
  expect(select.mock.calls[0][0]).toMatchObject({ kind: "file", sourceKind: "directory", workspaceRoot: "/project", path: "/project/folder", text: "a.txt\nchild/" });
  expect(close).toHaveBeenCalledOnce();
  expect(calls.read.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
});
it("cancels late snapshot results when the input owner changes and allows the new owner to select", async () => {
  let finish!: (value: typeof snapshot) => void;
  calls.read.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const select = vi.fn(), close = vi.fn();
  const view = render(<ProjectReferencePicker owner="codex:one" root="/project" onSelect={select} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "引用目录 folder" }));
  view.rerender(<ProjectReferencePicker owner="codex:two" root="/project" onSelect={select} onClose={close} />);
  await act(async () => finish(snapshot));
  expect(select).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "引用目录 folder" }));
  await waitFor(() => expect(select).toHaveBeenCalledOnce());
});
it("rejects a response that escapes the registered root or exceeds the context budget", () => {
  for (const value of [{ ...snapshot, path: "/outside" }, { ...snapshot, path: "/project/../outside" }, { ...snapshot, content: "x".repeat(180_001) },{...snapshot,content:"字".repeat(60001)},{...snapshot,root:"/",path:"/etc"}])
    expect(() => referenceContext(value)).toThrow(/无效/);
});
it("revokes a pending snapshot on a same-value native account notification even when thread and root stay equal",async()=>{let finish!:(value:typeof snapshot)=>void;calls.read.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const select=vi.fn(),close=vi.fn();render(<ProjectReferencePicker owner="codex:one" root="/project" onSelect={select} onClose={close}/>);fireEvent.click(await screen.findByRole("button",{name:"引用目录 folder"}));act(()=>resetGoalCompletionScope());await act(async()=>finish(snapshot));expect(select).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();});
