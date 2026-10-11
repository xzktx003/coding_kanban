import { expect, it, vi } from "vitest";
import { FeedbackUploads } from "./controller";
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
it.each([
  [
    "feedback report was accepted, but some attachments failed to upload",
    "incomplete",
  ],
  ["sending feedback is disabled by configuration", "disabled"],
  ["feedback uploads are already in progress", "failed"],
  ["network response lost", "unconfirmed"],
])(
  "preserves the original error state %s and retry permission",
  async (message, status) => {
    const submit = vi.fn().mockRejectedValue(new Error(message));
    const uploads = new FeedbackUploads();
    const id = uploads.start("thread-A", "owner-A", submit);
    await tick();
    expect(uploads.getSnapshot()[0]).toMatchObject({
      id,
      status,
      correlationId: "thread-A",
      open: true,
    });
    expect(uploads.retry(id)).toBe(status === "failed");
    expect(submit.mock.calls.length).toBe(status === "failed" ? 2 : 1);
    uploads.clear();
  },
);
it("dismissing an in-flight report leaves upload running and allows reopening with its final ID", async () => {
  let finish!: (id: string) => void;
  const submit = vi.fn(
    () =>
      new Promise<string>((r) => {
        finish = r;
      }),
  );
  const uploads = new FeedbackUploads();
  const id = uploads.start("thread-A", "owner-A", submit);
  uploads.dismiss(id);
  expect(uploads.getSnapshot()[0]).toMatchObject({
    status: "uploading",
    open: false,
    notification: true,
  });
  finish("feedback-A");
  await tick();
  expect(uploads.getSnapshot()[0]).toMatchObject({
    status: "uploaded",
    correlationId: "feedback-A",
    open: false,
    notification: true,
  });
  uploads.reopen(id);
  uploads.dismiss(id);
  expect(uploads.getSnapshot()).toEqual([]);
  expect(submit).toHaveBeenCalledTimes(1);
});
it("removing a notification or changing identity prevents late completion from resurrecting UI", async () => {
  let finish!: (id: string) => void;
  const uploads = new FeedbackUploads();
  const id = uploads.start(
    null,
    "owner-A",
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  uploads.dismiss(id);
  uploads.remove(id);
  finish("late");
  await tick();
  expect(uploads.getSnapshot()).toEqual([]);
});
it("retry never starts a second concurrent request and preserves the captured submit closure", async () => {
  let reject!: (error: Error) => void;
  const submit = vi.fn(
    () =>
      new Promise<string>((_, r) => {
        reject = r;
      }),
  );
  const uploads = new FeedbackUploads();
  const id = uploads.start("thread-A", "owner-A", submit);
  expect(uploads.retry(id)).toBe(false);
  reject(new Error("feedback uploads are already in progress"));
  await tick();
  expect(uploads.retry(id)).toBe(true);
  expect(uploads.retry(id)).toBe(false);
  expect(submit).toHaveBeenCalledTimes(2);
  uploads.clear();
});
it("publishes one initial snapshot and does not notify for repeated UI actions", () => {
  const uploads = new FeedbackUploads(),
    notify = vi.fn();
  uploads.subscribe(notify);
  const id = uploads.start("thread-A", "owner-A", () => new Promise(() => {}));
  expect(notify).toHaveBeenCalledTimes(1);
  uploads.reopen(id);
  expect(notify).toHaveBeenCalledTimes(1);
  uploads.dismiss(id);
  uploads.dismiss(id);
  expect(notify).toHaveBeenCalledTimes(2);
  uploads.clear();
});
