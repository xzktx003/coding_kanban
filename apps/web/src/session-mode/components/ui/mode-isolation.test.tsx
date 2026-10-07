import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "./alert-dialog";

test.each(["dialog", "alert"] as const)(
  "hidden %s releases body lock, focus trap and Escape without changing upper open state",
  async (kind) => {
    const change = vi.fn();
    const { container } = render(
      <>
        <button aria-label="终端控件">Terminal</button>
        <div className="session-mode">
          {kind === "dialog" ? (
            <Dialog open onOpenChange={change}>
              <DialogContent>
                <DialogTitle>测试对话</DialogTitle>
                <DialogDescription>隔离fixture</DialogDescription>
                <input aria-label="上层草稿" defaultValue="保留" />
              </DialogContent>
            </Dialog>
          ) : (
            <AlertDialog open onOpenChange={change}>
              <AlertDialogContent>
                <AlertDialogTitle>测试确认</AlertDialogTitle>
                <AlertDialogDescription>隔离fixture</AlertDialogDescription>
                <AlertDialogCancel>取消</AlertDialogCancel>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </>,
    );
    await waitFor(() => expect(document.body.style.pointerEvents).toBe("none"));
    const root = container.querySelector<HTMLElement>(".session-mode")!;
    root.hidden = true;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "terminal" }),
    );
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe("none");
      expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    });
    const terminal = screen.getByRole("button", { name: "终端控件" });
    terminal.focus();
    expect(document.activeElement).toBe(terminal);
    fireEvent.keyDown(terminal, { key: "Escape" });
    expect(change).not.toHaveBeenCalled();
    root.hidden = false;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "session" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole(kind === "dialog" ? "dialog" : "alertdialog"),
      ).toBeTruthy(),
    );
  },
);

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";
import { Popover, PopoverContent } from "./popover";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "./context-menu";
test.each(["dropdown", "popover", "context"] as const)(
  "hidden %s removes interaction layer and retains controlled upper state",
  async (kind) => {
    const change = vi.fn();
    const { container } = render(
      <>
        <button aria-label="终端切换">Terminal</button>
        <div className="session-mode">
          {kind === "dropdown" ? (
            <DropdownMenu open onOpenChange={change}>
              <DropdownMenuContent>
                <DropdownMenuItem>菜单项</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : kind === "popover" ? (
            <Popover open modal onOpenChange={change}>
              <PopoverContent>
                <input aria-label="浮层输入" />
              </PopoverContent>
            </Popover>
          ) : (
            <ContextMenu onOpenChange={change}>
              <ContextMenuTrigger>右键区域</ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>右键项</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        </div>
      </>,
    );
    if (kind === "context") fireEvent.contextMenu(screen.getByText("右键区域"));
    await waitFor(() => expect(document.body.style.pointerEvents).toBe("none"));
    change.mockClear();
    const root = container.querySelector<HTMLElement>(".session-mode")!;
    root.hidden = true;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "terminal" }),
    );
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe("none");
      expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    });
    const terminal = screen.getByRole("button", { name: "终端切换" });
    terminal.focus();
    expect(document.activeElement).toBe(terminal);
    fireEvent.keyDown(terminal, { key: "Escape" });
    expect(change).not.toHaveBeenCalled();
    root.hidden = false;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "session" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole(kind === "popover" ? "dialog" : "menu"),
      ).toBeTruthy(),
    );
  },
);

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./select";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./sheet";
test.each(["select", "sheet"] as const)(
  "hidden %s releases body lock and Escape",
  async (kind) => {
    HTMLElement.prototype.scrollIntoView ??= () => {};
    const change = vi.fn();
    const { container } = render(
      <>
        <button aria-label="终端工具">Terminal</button>
        <div className="session-mode">
          {kind === "select" ? (
            <Select open onOpenChange={change} value="a">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">模型A</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Sheet open onOpenChange={change}>
              <SheetContent>
                <SheetTitle>隔离侧栏</SheetTitle>
                <SheetDescription>侧栏fixture</SheetDescription>
                <input />
              </SheetContent>
            </Sheet>
          )}
        </div>
      </>,
    );
    await waitFor(() => expect(document.body.style.pointerEvents).toBe("none"));
    const root = container.querySelector<HTMLElement>(".session-mode")!;
    root.hidden = true;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "terminal" }),
    );
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe("none");
      expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    });
    const terminal = screen.getByRole("button", { name: "终端工具" });
    terminal.focus();
    fireEvent.keyDown(terminal, { key: "Escape" });
    expect(document.activeElement).toBe(terminal);
    expect(change).not.toHaveBeenCalled();
  },
);

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./tooltip";
test("hidden tooltip does not react to terminal Escape", async () => {
  const change = vi.fn();
  const { container } = render(
    <>
      <button aria-label="终端焦点">Terminal</button>
      <div className="session-mode">
        <TooltipProvider>
          <Tooltip open onOpenChange={change}>
            <TooltipTrigger>提示入口</TooltipTrigger>
            <TooltipContent>会话提示</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>,
  );
  await screen.findByRole("tooltip");
  const root = container.querySelector<HTMLElement>(".session-mode")!;
  root.hidden = true;
  window.dispatchEvent(
    new CustomEvent("workbench-mode-changed", { detail: "terminal" }),
  );
  await waitFor(() =>
    expect(document.querySelector('[role="tooltip"]')).toBeNull(),
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "终端焦点" }), {
    key: "Escape",
  });
  expect(change).not.toHaveBeenCalled();
});

import { HoverCard, HoverCardTrigger, HoverCardContent } from "./hover-card";
test("hidden hover card removes its interaction content", async () => {
  const { container } = render(
    <div className="session-mode">
      <HoverCard open>
        <HoverCardTrigger>详情</HoverCardTrigger>
        <HoverCardContent>会话详情</HoverCardContent>
      </HoverCard>
    </div>,
  );
  await waitFor(() =>
    expect(
      document.querySelector('[data-slot="hover-card-content"]'),
    ).not.toBeNull(),
  );
  container.querySelector<HTMLElement>(".session-mode")!.hidden = true;
  window.dispatchEvent(
    new CustomEvent("workbench-mode-changed", { detail: "terminal" }),
  );
  await waitFor(() =>
    expect(
      document.querySelector('[data-slot="hover-card-content"]'),
    ).toBeNull(),
  );
});
