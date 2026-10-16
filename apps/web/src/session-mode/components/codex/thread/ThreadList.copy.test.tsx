import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "@session/components/ui/use-toast";
import { clipboardFixture, deferredClipboard } from "@session/test/clipboardFixture";
import { ThreadList } from "./ThreadList";

const api = vi.hoisted(() => ({ list: vi.fn(), select: vi.fn(), fork: vi.fn() }));
vi.mock("@session/services/apiAdapt", () => ({ listThreads: api.list, archiveThread: vi.fn(), deleteThread: vi.fn() }));
vi.mock("@session/services/codexService", () => ({ codexService: { setCurrentThread: api.select, threadFork: api.fork } }));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@session/components/codex/thread/RenameThreadDialog", () => ({ RenameThreadDialog: () => null }));
const row = { id: "fixture-copy-id", name: "fixture row", preview: "fixture", cwd: "/fixture", createdAt: 1, updatedAt: 1 };
let clipboard: ReturnType<typeof clipboardFixture>;
beforeEach(() => {
  clipboard = clipboardFixture();
  vi.clearAllMocks();
  api.list.mockResolvedValue({ data: [row], nextCursor: null });
});
afterEach(() => clipboard.restore());
async function copy() {
  fireEvent.contextMenu(await screen.findByRole("button", { name: /fixture row/ }), { clientX: 10, clientY: 10 });
  fireEvent.click(await screen.findByText("Copy Id", { exact: true }));
}
it("copies only the captured thread ID over HTTP without opening or forking it", async () => {
  render(<ThreadList cwd="/fixture" />);
  await copy();
  await waitFor(() => expect(clipboard.texts).toEqual([row.id]));
  expect(clipboard.copyEvents).toEqual([expect.objectContaining({ data: { "text/plain": row.id }, defaultPrevented: true })]);
  expect(api.select).not.toHaveBeenCalled();
  expect(api.fork).not.toHaveBeenCalled();
});
it.each(["missing", "rejected"])("reports an unsuccessful %s clipboard instead of silently dropping Copy Id", async mode => {
  if (mode === "missing") clipboard.legacy.mockReturnValue(false);
  if (mode === "rejected") {
    const write = deferredClipboard();
    clipboard.modern(vi.fn(() => write.promise));
    write.reject(new Error("denied"));
  }
  render(<ThreadList cwd="/fixture" />);
  await copy();
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
  if (mode === "rejected") expect(clipboard.legacy).not.toHaveBeenCalled();
  expect(api.select).not.toHaveBeenCalled();
});
it.each(["project", "unmount"])("does not report a rejected pending copy after %s changes its scope", async mode => {
  const write = deferredClipboard();
  clipboard.modern(vi.fn(() => write.promise));
  clipboard.legacy.mockReturnValue(false);
  const view = render(<StrictMode><ThreadList cwd="/fixture" /></StrictMode>);
  await copy();
  expect(toast).not.toHaveBeenCalled();
  if (mode === "project") view.rerender(<StrictMode><ThreadList cwd="/other" /></StrictMode>);
  else view.unmount();
  await act(async () => write.reject(new Error("late denied")));
  expect(toast).not.toHaveBeenCalled();
});

it("keeps a successful pending Copy Id from opening the captured thread", async () => {
  const write = deferredClipboard(), writeText = vi.fn(() => write.promise);
  clipboard.modern(writeText);
  render(<StrictMode><ThreadList cwd="/fixture" /></StrictMode>);
  await copy();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(row.id);
  expect(api.select).not.toHaveBeenCalled();
  await act(async () => write.resolve());
  expect(api.select).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});
