import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodexMarkdown } from "./CodexMarkdown";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
it("renders interactive Markdown images without nesting a block gallery inside a paragraph", async () => {
  const { container } = render(
    <CodexMarkdown
      value={
        "Before the image.\n\n![Preview](https://fixture.invalid/image.png)\n\nAfter the image."
      }
    />,
  );
  expect(await screen.findByRole("img", { name: "Preview" })).toBeTruthy();
  expect(container.querySelector("p div")).toBeNull();
  expect(screen.getByText("Before the image.").tagName).toBe("P");
  expect(screen.getByText("After the image.").tagName).toBe("P");
});

import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach } from "vitest";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { fetchMarkdownImage } from "../../../../lib/api";
vi.mock("../../../../lib/api", () => ({ fetchMarkdownImage: vi.fn() }));

beforeEach(() => {
  useCodexStore.setState({
    threads: [{ id: "image-owner", cwd: "/project" } as never],
  });
  useWorkspaceStore.setState({ cwd: "/other-project" });
  vi.mocked(fetchMarkdownImage).mockReset();
  vi.mocked(fetchMarkdownImage).mockResolvedValue(
    new Blob(["image"], { type: "image/png" }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:chat-image"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

it("loads an absolute local Markdown image through its original thread's project, and releases it on unmount", async () => {
  const { unmount } = render(
    <CodexMarkdown
      threadId="image-owner"
      value="![草图](/project/.dev-runtime/designs/sketch.png)"
    />,
  );
  await waitFor(() => expect(fetchMarkdownImage).toHaveBeenCalled());
  expect(vi.mocked(fetchMarkdownImage).mock.calls[0][0]).toMatchObject({
    rootPath: "/project",
    source: "/project/.dev-runtime/designs/sketch.png",
  });
  expect(
    (await screen.findByRole("img", { name: "草图" })).getAttribute("src"),
  ).toBe("blob:chat-image");
  fireEvent.click(screen.getByRole("button", { name: "放大草图" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:chat-image");
});

it("does not request a local image outside the original project", async () => {
  render(
    <CodexMarkdown
      threadId="image-owner"
      value="![越界](/other-project/private.png)"
    />,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fetchMarkdownImage).not.toHaveBeenCalled();
});

it("shows a recoverable local-image error instead of a browser broken-image icon", async () => {
  vi.mocked(fetchMarkdownImage).mockRejectedValueOnce(
    new Error("Missing image"),
  );
  render(<CodexMarkdown threadId="image-owner" value="![草图](./草图.png)" />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByRole("img", { name: "草图" })).toBeTruthy();
  expect(fetchMarkdownImage).toHaveBeenCalledTimes(2);
});

it("aborts a pending read and ignores its late result after the original image unmounts", async () => {
  let resolve!: (blob: Blob) => void;
  vi.mocked(fetchMarkdownImage).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = render(
    <CodexMarkdown
      threadId="image-owner"
      value="![草图](/project/sketch.png)"
    />,
  );
  await waitFor(() => expect(fetchMarkdownImage).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(fetchMarkdownImage).mock.calls[0][1]!;
  unmount();
  expect(signal.aborted).toBe(true);
  resolve(new Blob(["late"], { type: "image/png" }));
  await new Promise((done) => setTimeout(done, 0));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("does not reload a captured thread's image when the active workspace changes", async () => {
  const { rerender } = render(
    <CodexMarkdown
      threadId="image-owner"
      value="![草图](/project/sketch.png)"
    />,
  );
  await screen.findByRole("img", { name: "草图" });
  useWorkspaceStore.setState({ cwd: "/third-project" });
  rerender(
    <CodexMarkdown
      threadId="image-owner"
      value="![草图](/project/sketch.png)"
    />,
  );
  expect(fetchMarkdownImage).toHaveBeenCalledTimes(1);
});
