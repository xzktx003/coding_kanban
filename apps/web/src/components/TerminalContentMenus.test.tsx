import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TerminalContentMenus } from "./TerminalContentMenus";
import { QUICK_LINKS_KEY } from "../lib/quick-links";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
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
it("adds persists opens and removes a LAN shortcut; unsafe URL remains rejected", () => {
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
  const link = screen.getByRole("link", { name: /Harness/ });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("href")).toBe("http://10.30.0.28:3430/");
  expect(JSON.parse(localStorage.getItem(QUICK_LINKS_KEY)!)).toHaveLength(1);
  view.unmount();
  render(<TerminalContentMenus {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "快捷链接" }));
  expect(screen.getByRole("link", { name: /Harness/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除链接 Harness" }));
  expect(screen.queryByRole("link")).toBeNull();
});

it("edits an existing link and keeps changes after remount", () => {
  localStorage.setItem(
    QUICK_LINKS_KEY,
    JSON.stringify([{ title: "原链接", url: "http://example.com/" }]),
  );
  const view = render(<TerminalContentMenus {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "快捷链接" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑链接 原链接" }));
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
  expect(screen.queryByRole("link", { name: /原链接/ })).toBeNull();
  view.unmount();
  render(<TerminalContentMenus {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "快捷链接" }));
  expect(
    screen.getByRole("link", { name: /新名称/ }).getAttribute("href"),
  ).toBe("https://example.org/tools");
});
