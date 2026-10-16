import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useCodexStore } from "../stores/useCodexStore";
import { clipboardFixture, deferredClipboard } from "@session/test/clipboardFixture";
import { ConversationMenu } from "./ConversationMenu";

const writes = vi.hoisted(() => ({ fork: vi.fn(), access: vi.fn(), request: vi.fn() }));
vi.mock("sonner", () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@session/services/codexService", () => ({ codexService: { threadFork: writes.fork } }));
vi.mock("@session/services/apiAdapt/codex", () => ({ archiveThread: vi.fn(), deleteThread: vi.fn(), threadAccess: writes.access }));
vi.mock("@session/features/thread-workflows/actions", () => ({ threadWorkflowActions: { request: writes.request } }));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "fixture", reasoningEffort: "medium", serviceTier: null,
    collaborationMode: "default", setReasoningEffort: vi.fn(), setServiceTier: vi.fn(), setCollaborationMode: vi.fn(),
  }),
}));

const copies = [
  ["复制最后一个代码块", "  literal citefixture  ", "已复制最后一个代码块", "未能复制代码块"],
  ["复制工作目录", "/fixture/project", "已复制工作目录", "未能复制工作目录"],
  ["复制对话路径", "/fixture/session.jsonl", "已复制对话路径", "未能复制对话路径"],
  ["复制页面链接", window.location.href, "已复制页面链接", "未能复制页面链接"],
] as const;
let clipboard: ReturnType<typeof clipboardFixture>;
beforeEach(() => {
  clipboard = clipboardFixture();
  vi.clearAllMocks();
  useCodexStore.setState({
    threads: [{ id: "copy-owner", cwd: "/fixture/project", path: "/fixture/session.jsonl" }],
    events: { "copy-owner": [{ params: { item: { type: "agentMessage", text: "```txt\n  literal citefixture  \n```" } } }] },
  } as never);
});
afterEach(() => clipboard.restore());
async function select(label: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: label }));
}

describe.each(copies)("%s", (label, text, success, failure) => {
  it("uses the real HTTP legacy path without changing the copied source", async () => {
    render(<ConversationMenu threadId="copy-owner" title="fixture" />);
    await select(label);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(success));
    expect(clipboard.texts).toEqual([text]);
    expect(clipboard.copyEvents).toEqual([expect.objectContaining({ data: { "text/plain": text }, defaultPrevented: true })]);
    expect(writes.fork).not.toHaveBeenCalled();
    expect(writes.access).not.toHaveBeenCalled();
    expect(writes.request).not.toHaveBeenCalled();
  });
  it("reports false legacy failure without success", async () => {
    clipboard.legacy.mockReturnValue(false);
    render(<ConversationMenu threadId="copy-owner" title="fixture" />);
    await select(label);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(failure));
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("reports a modern rejection without legacy retry or success", async () => {
    const write = deferredClipboard();
    clipboard.modern(vi.fn(() => write.promise));
    render(<ConversationMenu threadId="copy-owner" title="fixture" />);
    await select(label);
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => write.reject(new Error("denied")));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(failure));
    expect(clipboard.legacy).not.toHaveBeenCalled();
  });
});

it("ignores a copied reply after the owner changes and supports StrictMode", async () => {
  const write = deferredClipboard();
  clipboard.modern(vi.fn(() => write.promise));
  const view = render(<StrictMode><ConversationMenu threadId="copy-owner" title="fixture" /></StrictMode>);
  await select("复制最后一个代码块");
  view.rerender(<StrictMode><ConversationMenu threadId="next-owner" title="fixture" /></StrictMode>);
  await act(async () => write.resolve());
  expect(toast.success).not.toHaveBeenCalled();
  const next = vi.fn().mockResolvedValue(undefined);
  clipboard.modern(next);
  await select("复制页面链接");
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("已复制页面链接"));
});

it("does not announce a late result after unmount", async () => {
  const write = deferredClipboard();
  clipboard.modern(vi.fn(() => write.promise));
  const view = render(<ConversationMenu threadId="copy-owner" title="fixture" />);
  await select("复制工作目录");
  view.unmount();
  await act(async () => write.resolve());
  expect(toast.success).not.toHaveBeenCalled();
});
