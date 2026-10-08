import { afterEach, expect, it, vi } from "vitest";
import { open, pickBrowserFiles } from "./browser-dialog";

let clickSpy: ReturnType<typeof vi.spyOn> | undefined;

afterEach(() => {
  clickSpy?.mockRestore();
  clickSpy = undefined;
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
