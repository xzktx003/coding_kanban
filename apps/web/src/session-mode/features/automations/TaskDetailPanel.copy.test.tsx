import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "@session/components/ui/use-toast";
import type { AutomationTask } from "@session/services/apiAdapt";
import { clipboardFixture, deferredClipboard } from "@session/test/clipboardFixture";
import { TaskDetailPanel } from "./TaskDetailPanel";

const calls = vi.hoisted(() => ({ open: vi.fn(), select: vi.fn(), run: vi.fn(), interrupt: vi.fn(), models: vi.fn(async () => ({ data: [] })) }));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@session/services/builtinInputNavigation", () => ({ openBuiltinInputTarget: calls.open }));
vi.mock("@session/services/codexService", () => ({ codexService: { setCurrentThread: calls.select } }));
vi.mock("@session/services/followupService", () => ({ followupService: { stop: calls.interrupt } }));
vi.mock("@session/services/apiAdapt", () => ({ listModels: calls.models, runAutomationNow: calls.run, ccInterrupt: calls.interrupt, turnInterrupt: calls.interrupt }));
vi.mock("@session/hooks/useCCSessionManager", () => ({ useCCSessionManager: () => ({ handleSessionSelect: calls.select }) }));
vi.mock("@session/lib/sessions", () => ({ listSessions: vi.fn(async () => ({ sessions: [] })) }));
vi.mock("./useBotNames", () => ({ useBotNames: () => ({}) }));
vi.mock("./useAutomationRuns", () => ({ useRunEvents: () => [] }));
const task: AutomationTask = { id: "fixture-task", name: "fixture automation", projects: ["/fixture"], prompt: "fixture prompt", agent: "codex", model_provider: "openai", model: "fixture-model", schedule: { mode: "interval", interval_hours: 6, weekdays: [] }, cron_expression: "", created_at: "2026-01-01", paused: false, cwd_mode: "cwd" };
const run = { threadId: "fixture-run-id", taskId: task.id, taskName: task.name, startedAt: "2026-01-01", status: "completed", cwd: "/fixture" };
function panel(nextTask = task, nextRun = run) {
  return <TaskDetailPanel task={nextTask} runs={[nextRun]} now={new Date("2026-01-01")} togglingPauseTaskId={null} />;
}
let clipboard: ReturnType<typeof clipboardFixture>;
beforeEach(() => { clipboard = clipboardFixture(); vi.clearAllMocks(); });
afterEach(() => clipboard.restore());
it.each(["codex", "cc"] as const)("copies a %s automation ID over HTTP without opening/starting/interrupting a run", async agent => {
  render(panel({ ...task, agent }));
  fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: `${agent === "cc" ? "Session" : "Thread"} ID copied` }));
  expect(clipboard.texts).toEqual([run.threadId]);
  expect(clipboard.copyEvents).toEqual([expect.objectContaining({ data: { "text/plain": run.threadId }, defaultPrevented: true })]);
  expect(calls.open).not.toHaveBeenCalled(); expect(calls.select).not.toHaveBeenCalled();
  expect(calls.run).not.toHaveBeenCalled(); expect(calls.interrupt).not.toHaveBeenCalled();
});
it.each(["missing", "rejected"])("reports %s copy failure without a false success toast", async mode => {
  if (mode === "missing") clipboard.legacy.mockReturnValue(false);
  if (mode === "rejected") {
    const write = deferredClipboard(); clipboard.modern(vi.fn(() => write.promise)); write.reject(new Error("denied"));
  }
  render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
  expect(toast).not.toHaveBeenCalledWith({ title: "Thread ID copied" });
  if (mode === "rejected") expect(clipboard.legacy).not.toHaveBeenCalled();
});
it("waits for a pending clipboard receipt before reporting success", async () => {
  const write = deferredClipboard(); clipboard.modern(vi.fn(() => write.promise));
  render(<StrictMode>{panel()}</StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));
  expect(toast).not.toHaveBeenCalled();
  await act(async () => write.resolve());
  expect(toast).toHaveBeenCalledExactlyOnceWith({ title: "Thread ID copied" });
});
it.each(["replacement", "unmount"])("does not report an old run's pending result after %s", async mode => {
  const write = deferredClipboard(); clipboard.modern(vi.fn(() => write.promise));
  const view = render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));
  expect(toast).not.toHaveBeenCalled();
  if (mode === "replacement") view.rerender(panel({ ...task, id: "next-task" }, { ...run, taskId: "next-task" }));
  else view.unmount();
  await act(async () => write.resolve());
  expect(toast).not.toHaveBeenCalled();
});

it.each(["Enter", " "])("does not open a run when Copy ID receives %j before its copy click", async key => {
  render(panel());
  const copy = screen.getByRole("button", { name: "Copy ID" });
  fireEvent.keyDown(copy, { key });
  expect(calls.open).not.toHaveBeenCalled();
  expect(calls.select).not.toHaveBeenCalled();
  expect(calls.run).not.toHaveBeenCalled();
  expect(calls.interrupt).not.toHaveBeenCalled();
  fireEvent.click(copy);
  await waitFor(() => expect(clipboard.texts).toEqual([run.threadId]));
  expect(calls.open).not.toHaveBeenCalled();
  expect(calls.select).not.toHaveBeenCalled();
});

it.each(["Enter", " "])("opens the run row itself on %j without copying its ID", async key => {
  render(panel());
  const row = screen.getByRole("button", { name: "Copy ID" }).closest('[role="button"]');
  expect(row).not.toBeNull();
  fireEvent.keyDown(row!, { key });
  await waitFor(() => expect(calls.select).toHaveBeenCalledExactlyOnceWith(run.threadId));
  expect(calls.open).toHaveBeenCalledOnce();
  expect(calls.run).not.toHaveBeenCalled();
  expect(calls.interrupt).not.toHaveBeenCalled();
  expect(clipboard.legacy).not.toHaveBeenCalled();
});
