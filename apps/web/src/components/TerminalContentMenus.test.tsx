import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TerminalContentMenus } from "./TerminalContentMenus";
import type { QuickLink } from "../lib/quick-links";
let stored: QuickLink[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith("terminal-quick-links") && init?.method === "PUT") {
    stored = JSON.parse(String(init.body));
    return new Response(JSON.stringify(stored), { status: 200 });
  }
  return new Response(JSON.stringify(stored), { status: 200 });
});
afterEach(() => {
  cleanup();
  stored = [];
  vi.stubGlobal("fetch", fetchMock);
});
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
const props = {
  fileBrowserAvailable: true,
  fileBrowserOpen: false,
  vscodeAvailable: true,
  vscodeOpen: false,
  onToggleFileBrowser: vi.fn(),
  onToggleVsCode: vi.fn(),
};
it("groups tools and preserves enabled callbacks and Escape focus", () => {
  render(<TerminalContentMenus {...props} />);
  expect(screen.queryByTestId("vscode-toggle")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "侧边内容" }));
  fireEvent.click(screen.getByTestId("vscode-toggle"));
  expect(props.onToggleVsCode).toHaveBeenCalledTimes(1);
  const trigger = screen.getByRole("button", { name: "侧边内容" });
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
});
it("adds persists opens and removes a LAN shortcut; unsafe URL remains rejected", async () => {
  const view = render(<TerminalContentMenus {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "快捷链接" }));
  fireEvent.click(screen.getByRole("button", { name: "添加快捷链接" }));
  fireEvent.change(screen.getByLabelText("链接名称"), {
    target: { value: "Harness" },
  });
  fireEvent.change(screen.getByLabelText("网址"), {
    target: { value: "http://10.30.0.28:3430/" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "保存链接" }).closest("form")!,
  );
  await waitFor(() => expect(stored).toHaveLength(1));
  const link = await screen.findByRole("link", { name: /Harness/ });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("href")).toBe("http://10.30.0.28:3430/");
  expect(stored).toHaveLength(1);
  view.unmount();
  render(<TerminalContentMenus {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "快捷链接" }));
  expect(await screen.findByRole("link", { name: /Harness/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除链接 Harness" }));
  await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
});

it("edits an existing link and keeps changes after remount", async () => {
  stored = [{ title: "原链接", url: "http://example.com/" }];
  const view = render(<TerminalContentMenus {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "快捷链接" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑链接 原链接" }));
  expect((screen.getByLabelText("网址") as HTMLInputElement).value).toBe(
    "http://example.com/",
  );
  fireEvent.change(screen.getByLabelText("链接名称"), {
    target: { value: "新名称" },
  });
  fireEvent.change(screen.getByLabelText("网址"), {
    target: { value: "https://example.org/tools" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "保存修改" }).closest("form")!,
  );
  await waitFor(() => expect(screen.queryByRole("link", { name: /原链接/ })).toBeNull());
  await waitFor(() => expect(stored[0]?.title).toBe("新名称"));
  view.unmount();
  render(<TerminalContentMenus {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "快捷链接" }));
  expect((await screen.findByRole("link", { name: /新名称/ })).getAttribute("href")).toBe("https://example.org/tools");
});
