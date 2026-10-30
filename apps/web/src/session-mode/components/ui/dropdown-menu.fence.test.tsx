import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(() => {
  document.body.style.removeProperty("pointer-events");
});
function Menu({ open }: { open?: boolean }) {
  return (
    <DropdownMenu open={open}>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Export</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
it("opens in the current session root after replacing a loading document shell", async () => {
  const view = render(<main className="session-mode">Loading shell</main>);
  const retired = screen.getByText("Loading shell");
  view.rerender(
    <div className="session-mode">
      <Menu />
    </div>,
  );
  expect(retired.isConnected).toBe(false);
  fireEvent.keyDown(screen.getByRole("button", { name: "Menu" }), {
    key: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  expect(menu.closest(".session-mode")?.isConnected).toBe(true);
});
it("releases a stale inherited pointer fence when content closes while its wrapper stays mounted", async () => {
  document.body.style.pointerEvents = "none";
  const view = render(<Menu open />);
  await waitFor(() =>
    expect(document.querySelector('[role="menu"]')).not.toBeNull(),
  );
  view.rerender(<Menu open={false} />);
  await waitFor(() =>
    expect(document.querySelector('[role="menu"]')).toBeNull(),
  );
  await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
});
it("keeps a different open dialog's fence while a menu closes", async () => {
  const dialog = document.createElement("div");
  dialog.dataset.slot = "dialog-content";
  dialog.dataset.state = "open";
  document.body.append(dialog);
  document.body.style.pointerEvents = "none";
  const view = render(<Menu open />);
  try {
    view.rerender(<Menu open={false} />);
    await waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    expect(document.body.style.pointerEvents).toBe("none");
  } finally {
    dialog.remove();
  }
});
