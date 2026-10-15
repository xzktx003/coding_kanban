import { afterEach, expect, it, vi } from "vitest";
import { open, pickBrowserFiles, uploadBrowserFile } from "./browser-dialog";

let clickSpy: ReturnType<typeof vi.spyOn> | undefined;

afterEach(() => {
  clickSpy?.mockRestore();
  clickSpy = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("uses the native image accept hint for mobile file pickers", async () => {
  let input: HTMLInputElement | undefined;
  clickSpy = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(function (this: HTMLInputElement) {
      input = this;
    });

  const pending = open({
    multiple: true,
    accept: "image/*",
    filters: [{ name: "Images", extensions: ["png"] }],
  });

  expect(input?.multiple).toBe(true);
  expect(input?.accept).toBe("image/*");
  input?.oncancel?.(new Event("cancel"));
  await expect(pending).resolves.toBeNull();
  expect(input?.isConnected).toBe(false);
});

function stubUploadReader(hang = false) {
  class Reader {
    result = "data:image/png;base64,cGhvdG8=";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    readAsDataURL = vi.fn(() => {
      if (!hang) queueMicrotask(() => this.onload?.());
    });
    abort = vi.fn(() => this.onabort?.());
    constructor() {
      readers.push(this);
    }
  }
  const readers: Reader[] = [];
  vi.stubGlobal("FileReader", Reader);
  return readers;
}
function observeUpload(file: File) {
  const outcome: { settled: boolean; value?: string; error?: Error } = {
    settled: false,
  };
  void uploadBrowserFile(file).then(
    (value) => Object.assign(outcome, { settled: true, value }),
    (error) => Object.assign(outcome, { settled: true, error }),
  );
  return outcome;
}

it("times out stalled file reading, aborts it and does not start an upload from a late read", async () => {
  vi.useFakeTimers();
  const readers = stubUploadReader(true);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const outcome = observeUpload(new File(["photo"], "photo.png"));
  const lateRead = readers[0].onload!;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(outcome.settled).toBe(true);
  expect(outcome.error?.message).toContain("超时");
  expect(readers[0].abort).toHaveBeenCalledOnce();
  lateRead();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).not.toHaveBeenCalled();
});

it("releases a stalled upload for explicit retry and ignores its late response", async () => {
  vi.useFakeTimers();
  stubUploadReader();
  let resolveUpload!: (response: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const file = new File(["photo"], "photo.png");
  const outcome = observeUpload(file);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(outcome.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(outcome.settled).toBe(true);
  expect(outcome.error?.message).toContain("超时");
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ path: "/retry.png" }),
  });
  await expect(uploadBrowserFile(file)).resolves.toBe("/retry.png");
  resolveUpload({ ok: true, json: async () => ({ path: "/late.png" }) });
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome.value).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("includes a stalled response body in the upload deadline", async () => {
  vi.useFakeTimers();
  stubUploadReader();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }),
  );
  const outcome = observeUpload(new File(["photo"], "photo.png"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(outcome.settled).toBe(true);
  expect(outcome.error?.message).toContain("超时");
});

it("returns native files before any upload, preserving bytes and cleaning up the picker", async () => {
  let input: HTMLInputElement | undefined;
  clickSpy = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(function (this: HTMLInputElement) {
      input = this;
    });
  const pending = pickBrowserFiles({ multiple: true, accept: "image/*" });
  const files = [
    new File(["one"], "one.png", { type: "image/png" }),
    new File(["two"], "two.jpg", { type: "image/jpeg" }),
  ];
  expect(input?.isConnected).toBe(true);
  Object.defineProperty(input, "files", { value: files });
  input?.onchange?.(new Event("change"));
  await expect(pending).resolves.toEqual(files);
  expect(input?.isConnected).toBe(false);
});
