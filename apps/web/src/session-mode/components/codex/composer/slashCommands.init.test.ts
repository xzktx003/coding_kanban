import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ list: vi.fn(), start: vi.fn() }));
vi.mock("@session/features/files/projectReferences", () => ({ listProjectReferences: api.list }));
vi.mock("@session/services/codexService", () => ({ codexService: { turnStart: api.start } }));
import { SLASH_COMMANDS } from "./slashCommands";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
const ensureThread = vi.fn(async () => "source");
const run = () => SLASH_COMMANDS.find((command) => command.id === "init")!.run({ currentThreadId: "source", ensureThread, openDialog: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ cwd: "/different-selected-project" });
  useCodexStore.setState({ currentThreadId: "source", threads: [{ id: "source", cwd: "/exact-thread-project" } as any] });
});
it("checks the exact native thread directory and refuses to send when AGENTS.md already exists", async () => {
  api.list.mockResolvedValue({ entries: [{ name: "AGENTS.md", kind: "file" }], truncated: false });
  await expect(run()).rejects.toThrow(/AGENTS.md.*存在/);
  expect(api.list).toHaveBeenCalledWith("/exact-thread-project", "/exact-thread-project", expect.any(AbortSignal));
  expect(ensureThread).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});
it("does not infer absence from truncated project metadata", async () => {
  api.list.mockResolvedValue({ entries: [], truncated: true });
  await expect(run()).rejects.toThrow(/无法确认/);
  expect(api.start).not.toHaveBeenCalled();
});
it("starts one generation task only after the complete read confirms absence", async () => {
  api.list.mockResolvedValue({ entries: [], truncated: false });
  await run();
  expect(ensureThread).toHaveBeenCalledTimes(1);
  expect(api.start).toHaveBeenCalledTimes(1);
  expect(api.start.mock.calls[0][0]).toBe("source");
});

it("does not advertise an unavailable IDE automatic context command",()=>{
  expect(SLASH_COMMANDS.some(command=>command.id==="ide"||command.id==="ide-context")).toBe(false);
});
