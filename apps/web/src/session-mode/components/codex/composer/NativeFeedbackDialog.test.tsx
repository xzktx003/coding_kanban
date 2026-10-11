import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NativeFeedbackDialog } from "./NativeFeedbackDialog";
const upload = vi.hoisted(() => vi.fn());

beforeEach(() => {
  upload.mockReset();
});
const fill = () => {
  fireEvent.click(screen.getByRole("radio", { name: "结果异常" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "  captured details  " },
  });
};
it("requires classification and nonempty details; captures classification, log consent and owner once", async () => {
  let finish!: () => void;
  upload.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const close = vi.fn();
  render(
    <NativeFeedbackDialog
      submitFeedback={upload}
      threadId="owner-A"
      onClose={close}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "提交",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fill();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  expect(upload).toHaveBeenCalledExactlyOnceWith(
    "owner-A",
    "  captured details  ",
    { classification: "bad-result", includeLogs: false },
  );
  expect(
    screen.getByRole("button", { name: "提交" }).getAttribute("aria-busy"),
  ).toBe("true");
  finish();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});
it("retains details and selection after a failed upload and allows a retry", async () => {
  upload.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
  const close = vi.fn();
  render(
    <NativeFeedbackDialog
      submitFeedback={upload}
      threadId="owner-A"
      onClose={close}
    />,
  );
  fill();
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "提交" }).getAttribute("aria-busy"),
    ).toBeNull(),
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "  captured details  ",
  );
  expect(close).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(upload).toHaveBeenCalledTimes(2);
});
it("a dismissed owner's late completion cannot close a newly opened form", async () => {
  let finish!: () => void;
  upload.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const oldClose = vi.fn(),
    newClose = vi.fn();
  const old = render(
    <NativeFeedbackDialog
      submitFeedback={upload}
      threadId="owner-A"
      onClose={oldClose}
    />,
  );
  fill();
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  old.unmount();
  render(
    <NativeFeedbackDialog
      submitFeedback={upload}
      threadId="owner-B"
      onClose={newClose}
    />,
  );
  finish();
  await waitFor(() =>
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""),
  );
  expect(oldClose).not.toHaveBeenCalled();
  expect(newClose).not.toHaveBeenCalled();
});
