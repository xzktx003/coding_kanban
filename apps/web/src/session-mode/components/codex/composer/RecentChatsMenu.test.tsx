import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { RecentChatsMenu } from "./RecentChatsMenu";

const select = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@session/services/codexService", () => ({ codexService: { setCurrentThread: select } }));

const thread = (id: string, preview: string) => ({ id, preview, parentThreadId: null });

beforeEach(() => {
  select.mockClear();
  useCodexStore.setState({ threads: [], activeThreadIds: [], currentThreadId: null });
});

it("filters loaded chats and clears the query on Escape", async () => {
  useCodexStore.setState({ threads: [thread("one", "目标会话"), thread("two", "其他会话")] as never, activeThreadIds: ["two"] });
  render(<RecentChatsMenu />);
  fireEvent.click(screen.getByRole("button", { name: /^最近聊天$/ }));
  expect(screen.getByRole("button", { name: "目标会话" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索最近聊天" }), { target: { value: "目标" } });
  expect(screen.queryByRole("button", { name: "其他会话" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "目标会话" }));
  expect(select).toHaveBeenCalledExactlyOnceWith("one");
  fireEvent.click(screen.getByRole("button", { name: /^最近聊天$/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索最近聊天" }), { target: { value: "临时" } });
  expect(screen.getByText("还没有匹配的聊天")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "搜索最近聊天" }), { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "搜索最近聊天" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^最近聊天$/ }));
  expect((screen.getByRole("textbox", { name: "搜索最近聊天" }) as HTMLInputElement).value).toBe("");
});

it("shows the official empty state without selecting anything", () => {
  render(<RecentChatsMenu />);
  const trigger = screen.getByRole("button", { name: /^最近聊天$/ });
  expect(trigger.textContent).toBe("最近聊天");
  fireEvent.click(trigger);
  expect(screen.getByRole("menu", { name: "搜索最近聊天" })).toBeTruthy();
  expect(screen.getByText("还没有聊天")).toBeTruthy();
  expect(select).not.toHaveBeenCalled();
});

it("closes on outside pointer input without selecting a chat", () => {
  useCodexStore.setState({ threads: [thread("one", "会话")] as never });
  render(<RecentChatsMenu />);
  fireEvent.click(screen.getByRole("button", { name: /^最近聊天$/ }));
  expect(screen.getByRole("menu", { name: "搜索最近聊天" })).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu", { name: "搜索最近聊天" })).toBeNull();
  expect(select).not.toHaveBeenCalled();
});

it("returns focus to the trigger when Escape closes search", () => {
  render(<RecentChatsMenu />);
  const trigger = screen.getByRole("button", { name: /^最近聊天$/ });
  fireEvent.click(trigger);
  const search = screen.getByRole("textbox", { name: "搜索最近聊天" });
  search.focus();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "搜索最近聊天" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("does not label resumed chats as work that is currently in progress", () => {
  useCodexStore.setState({
    threads: [thread("one", "会话一"), thread("two", "会话二")] as never,
    activeThreadIds: ["one", "two"],
  });
  render(<RecentChatsMenu />);
  const trigger = screen.getByRole("button", { name: /^最近聊天$/ });
  expect(trigger.textContent).toBe("最近聊天");
});
