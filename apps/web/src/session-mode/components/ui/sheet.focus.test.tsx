import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@session/session-dom", () => ({
  sessionPortalContainer: () => document.body,
  useSessionInteractionVisible: () => true,
  isSessionInteractionVisible: () => true,
}));
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./sheet";
function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开项目</button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle>项目与会话列表</SheetTitle>
          <SheetDescription>选择项目与会话</SheetDescription>
          <button>列表操作</button>
        </SheetContent>
      </Sheet>
    </>
  );
}
it("returns focus to an external trigger when a controlled sheet closes", async () => {
  render(<Fixture />);
  const trigger = screen.getByRole("button", { name: "打开项目" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
