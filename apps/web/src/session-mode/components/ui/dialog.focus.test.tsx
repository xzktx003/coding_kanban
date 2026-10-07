import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>外部打开按钮</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>测试弹窗</DialogTitle>
          <button onClick={() => setOpen(false)}>完成</button>
        </DialogContent>
      </Dialog>
    </>
  );
}
it("returns focus to an external opener of a controlled dialog", async () => {
  render(
    <div className="session-mode">
      <Example />
    </div>,
  );
  const opener = screen.getByRole("button", { name: "外部打开按钮" });
  opener.focus();
  fireEvent.click(opener);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
});
