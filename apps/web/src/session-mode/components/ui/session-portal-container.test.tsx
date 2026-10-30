import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogCancel,
} from "./alert-dialog";

const cases = [
  [
    "popover",
    <Popover>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>Live content</PopoverContent>
    </Popover>,
  ],
  [
    "dialog",
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Live content</DialogTitle>
      </DialogContent>
    </Dialog>,
  ],
  [
    "sheet",
    <Sheet>
      <SheetTrigger>Open</SheetTrigger>
      <SheetContent aria-describedby={undefined}>
        <SheetTitle>Live content</SheetTitle>
      </SheetContent>
    </Sheet>,
  ],
  [
    "alert",
    <AlertDialog>
      <AlertDialogTrigger>Open</AlertDialogTrigger>
      <AlertDialogContent aria-describedby={undefined}>
        <AlertDialogTitle>Live content</AlertDialogTitle>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>,
  ],
] as const;

it.each(cases)(
  "%s uses the committed session root after the loading shell is replaced",
  async (_name, layer) => {
    const view = render(<main className="session-mode">Loading shell</main>);
    const retired = screen.getByText("Loading shell");
    view.rerender(<div className="session-mode">{layer}</div>);
    expect(retired.isConnected).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(
      (await screen.findByText("Live content")).closest(".session-mode")
        ?.isConnected,
    ).toBe(true);
  },
);
