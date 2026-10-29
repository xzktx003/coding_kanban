import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "@session/components/ui/use-toast";
import { ThreadList } from "./ThreadList";

/**
 * Original local-thread archive (`GG` @2428310 in app-initial-41ab338a184f.js)
 * reports its failure through `KG.archiveThreadError`, which zh renders as
 * 聊天归档未成功. Our row action reported an untranslated English string, and
 * reported nothing at all on success, so an archive from the rail was silent.
 *
 * The menu item label itself stays English ("Archive"), matching the rest of the
 * row menu and the labels already pinned by ThreadList.usability.test.tsx and the
 * e2e specs; only the user-facing notices are localized here.
 *
 * Success copy and the undo entry are the same ones the composer archive sheet
 * uses, so both entry points behave alike; see archiveThreadUndo.ts for why the
 * undo rides on the notice rather than on a global keyboard command.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  select: vi.fn(),
  fork: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
}));
vi.mock("@session/services/apiAdapt", () => ({
  listThreads: api.list,
  archiveThread: api.archive,
  deleteThread: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  unarchiveThread: api.unarchive,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: api.select, threadFork: api.fork },
}));
vi.mock("@session/components/ui/use-toast", () => {
  const fn = vi.fn() as never as Record<string, unknown> & (() => void);
  return {
    toast: Object.assign(fn, {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      message: vi.fn(),
    }),
  };
});
vi.mock("@session/components/codex/thread/RenameThreadDialog", () => ({
  RenameThreadDialog: () => null,
}));

const row = {
  id: "fixture-archive-id",
  name: "fixture row",
  preview: "fixture",
  cwd: "/fixture",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({ data: [row], nextCursor: null });
  api.archive.mockResolvedValue({});
  api.unarchive.mockResolvedValue({});
});

async function archiveFromRow() {
  render(<ThreadList cwd="/fixture" />);
  fireEvent.contextMenu(await screen.findByRole("button", { name: /fixture row/ }), {
    clientX: 10,
    clientY: 10,
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
  return toast as unknown as {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    message: ReturnType<typeof vi.fn>;
  };
}

it("confirms a successful archive from the rail instead of staying silent", async () => {
  const t = await archiveFromRow();
  await waitFor(() => expect(api.archive).toHaveBeenCalledWith(row.id));
  await waitFor(() =>
    expect(t.message).toHaveBeenCalledWith("已归档聊天", expect.anything()),
  );
});

it("offers the same undo entry the composer archive sheet offers", async () => {
  const t = await archiveFromRow();
  await waitFor(() => expect(t.message).toHaveBeenCalled());
  const options = t.message.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  const action = options?.action as { label?: string; onClick: () => void };
  expect(action?.label).toBe("撤销");
  action.onClick();
  await waitFor(() => expect(api.unarchive).toHaveBeenCalledWith(row.id));
});

it("reports the official failure copy rather than an untranslated string", async () => {
  api.archive.mockRejectedValueOnce(new Error("nope"));
  const t = await archiveFromRow();
  // Official `threadActions.archiveThread.archiveThreadError` zh string.
  await waitFor(() =>
    expect(t.error).toHaveBeenCalledWith("聊天归档未成功", expect.anything()),
  );
  expect(t.error).not.toHaveBeenCalledWith(
    "Failed to archive thread",
    expect.anything(),
  );
});

it("does not announce success when the archive write fails", async () => {
  api.archive.mockRejectedValueOnce(new Error("nope"));
  const t = await archiveFromRow();
  await waitFor(() => expect(t.error).toHaveBeenCalled());
  expect(t.message).not.toHaveBeenCalled();
  expect(t.success).not.toHaveBeenCalled();
});
