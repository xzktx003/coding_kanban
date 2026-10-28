import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent } from "./popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { SessionPortalDocumentProvider } from "@session/session-dom";

/**
 * The independent plan window (`PlanWindowEntry`) renders session UI into a real
 * second document and wraps it in `SessionPortalDocumentProvider`, the same way
 * `dialog.tsx` already reads that document before choosing a portal container.
 * A menu opened inside that window has to land in the window's own
 * `.session-mode` root; portalling it back into the opener leaves the popup with
 * no menu at all and drops the layer into the page behind it.
 *
 * jsdom refuses `window.open`, so the second window is stood in by a second
 * `Document` — the distinction the container choice actually turns on.
 */
const owned: HTMLElement[] = [];

const ownedDocumentRoot = () => {
  const ownerDocument = document.implementation.createHTMLDocument("plan");
  const root = ownerDocument.createElement("div");
  root.className = "session-mode dark";
  ownerDocument.body.append(root);
  return { ownerDocument, root };
};

const mainRoot = () => {
  const root = document.createElement("div");
  root.className = "session-mode";
  document.body.append(root);
  owned.push(root);
  return root;
};

afterEach(() => {
  while (owned.length) owned.pop()?.remove();
});

it("keeps a dropdown menu inside the document that owns it", async () => {
  const { ownerDocument, root } = ownedDocumentRoot();
  render(
    <SessionPortalDocumentProvider ownerDocument={ownerDocument}>
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuItem>复制 · TSV</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SessionPortalDocumentProvider>,
    { container: root, baseElement: ownerDocument.body },
  );
  await waitFor(() =>
    expect(ownerDocument.querySelector('[role="menu"]')).not.toBeNull(),
  );
  expect(ownerDocument.querySelector('[role="menu"]')?.closest(".session-mode")).toBe(
    root,
  );
  // The opener must stay clean: a menu leaking into it is the bug this guards.
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("keeps a popover inside the document that owns it", async () => {
  const { ownerDocument, root } = ownedDocumentRoot();
  render(
    <SessionPortalDocumentProvider ownerDocument={ownerDocument}>
      <Popover open>
        <PopoverContent>窗口内浮层</PopoverContent>
      </Popover>
    </SessionPortalDocumentProvider>,
    { container: root, baseElement: ownerDocument.body },
  );
  await waitFor(() =>
    expect(ownerDocument.body.textContent).toContain("窗口内浮层"),
  );
  expect(document.body.textContent).not.toContain("窗口内浮层");
});

it("still portals into the main session root with no owner document", async () => {
  const root = mainRoot();
  render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <DropdownMenuItem>复制 · TSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
    { container: root },
  );
  await screen.findByRole("menu");
  expect(screen.getByRole("menu").closest(".session-mode")).toBe(root);
});

/**
 * Two sibling menus in the same document, opened one after the other, is exactly
 * what the independent plan window does: the code fence's menu, then the table's.
 * Radix fences a modal menu with `pointer-events: none` on the body; the real
 * plan window ended with that fence still set while no menu was open at all, so
 * the table trigger reported `data-state="open"` and every click was swallowed.
 * The invariant is that a fence may only outlive a menu that is still open.
 */
it("never leaves a pointer fence behind without an open menu", async () => {
  const root = mainRoot();
  const Pair = ({ open }: { open: "fence" | "table" | null }) => (
    <>
      <DropdownMenu open={open === "fence"}>
        <DropdownMenuTrigger>代码块更多操作</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>下载代码</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu open={open === "table"}>
        <DropdownMenuTrigger>表格更多操作</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>复制 · TSV</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const fenced = () =>
    document.body.style.pointerEvents === "none" &&
    !document.querySelector('[data-state="open"][data-slot$="-content"]');

  const view = render(<Pair open="fence" />, { container: root });
  await screen.findByRole("menuitem", { name: "下载代码" });
  // Switching straight across is what the plan window does after the download.
  view.rerender(<Pair open="table" />);
  await screen.findByRole("menuitem", { name: "复制 · TSV" });
  expect(fenced()).toBe(false);
  view.rerender(<Pair open={null} />);
  await waitFor(() =>
    expect(document.querySelector('[role="menu"]')).toBeNull(),
  );
  // A fence surviving the last menu is what killed every later click.
  await waitFor(() => expect(fenced()).toBe(false));
});

/**
 * The table and code-fence action buttons inside the plan window carry rich
 * tooltips, so the tooltip layer has the same owner-document obligation the
 * menu and popover layers do: portalling it into the opener leaves the popup
 * with no hint and drops the layer into the page behind it.
 */
it("keeps a tooltip inside the document that owns it", async () => {
  const { ownerDocument, root } = ownedDocumentRoot();
  render(
    <SessionPortalDocumentProvider ownerDocument={ownerDocument}>
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>复制表格</TooltipTrigger>
          <TooltipContent>窗口内提示</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </SessionPortalDocumentProvider>,
    { container: root, baseElement: ownerDocument.body },
  );
  await waitFor(() =>
    expect(ownerDocument.body.textContent).toContain("窗口内提示"),
  );
  expect(document.body.textContent).not.toContain("窗口内提示");
});

/**
 * The opener's own `.session-mode` root goes `hidden` whenever the workbench
 * switches to terminal mode. The plan window is a separate OS window and keeps
 * showing its content, so its layers must not be blanked by that state: the
 * visibility guard has to yield to an explicit owner document.
 */
it.each([
  [
    "dropdown menu",
    <DropdownMenu open>
      <DropdownMenuContent>
        <DropdownMenuItem>复制 · TSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
    "复制 · TSV",
  ],
  ["popover", <Popover open><PopoverContent>窗口内浮层</PopoverContent></Popover>, "窗口内浮层"],
  [
    "tooltip",
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger>复制表格</TooltipTrigger>
        <TooltipContent>窗口内提示</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
    "窗口内提示",
  ],
])("keeps a %s showing while the opener is hidden", async (_name, layer, text) => {
  const opener = mainRoot();
  opener.hidden = true;
  const { ownerDocument, root } = ownedDocumentRoot();
  render(
    <SessionPortalDocumentProvider ownerDocument={ownerDocument}>
      {layer}
    </SessionPortalDocumentProvider>,
    { container: root, baseElement: ownerDocument.body },
  );
  await waitFor(() => expect(ownerDocument.body.textContent).toContain(text));
});
