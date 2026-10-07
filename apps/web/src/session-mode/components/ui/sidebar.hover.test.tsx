import { fireEvent, render, screen, act } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Sidebar, SidebarProvider } from "./sidebar";

test("collapsed sidebar peeks without changing layout and closes after leaving", async () => {
  vi.useFakeTimers();
  try {
    const change = vi.fn();
    const { container } = render(
      <div className="session-mode">
        <SidebarProvider open={false} onOpenChange={change}>
          <Sidebar>Project list</Sidebar>
        </SidebarProvider>
      </div>,
    );
    const edge = screen.getByRole("button", { name: "悬浮展开侧栏" });
    fireEvent.pointerEnter(edge, { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTime(160));
    expect(
      container
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-peek"),
    ).toBe("true");
    expect(change).not.toHaveBeenCalled();
    fireEvent.pointerLeave(
      container.querySelector('[data-slot="sidebar-container"]')!,
    );
    await act(async () => vi.advanceTimersByTime(260));
    expect(
      container
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-peek"),
    ).toBe("false");
  } finally {
    vi.useRealTimers();
  }
});
