import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeGeneratedImages } from "./NativeGeneratedImages";
import { CodexContentOwner } from "../presentation/ownerContext";
import { useCodexStore } from "../stores/useCodexStore";
const add = vi.hoisted(() => vi.fn());
vi.mock("@session/components/common/useImageAttachments", () => ({
  useImageAttachments: (owner: string) => ({
    addFiles: (files: File[]) => add(owner, files),
  }),
}));
vi.mock("../composer/v2/DrawingEditor", () => ({
  DrawingEditor: ({ owner, item, attachments }: any) => (
    <button onClick={() => attachments.addFiles([item.file])}>
      保存 {owner}
    </button>
  ),
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
const image = {
  id: "generated",
  status: "completed",
  result:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/DZkAAAAASUVORK5CYII=",
  revisedPrompt: null,
};
it("edits actual generated pixels and keeps saving in the original owner's draft after navigation", async () => {
  useCodexStore.setState({
    threads: [
      { id: "one", cwd: "/one" },
      { id: "two", cwd: "/two" },
    ] as never,
  });
  const { rerender } = render(
    <CodexContentOwner.Provider value="one">
      <NativeGeneratedImages items={[image]} />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑图片" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /保存/ })).toBeTruthy(),
  );
  rerender(
    <CodexContentOwner.Provider value="two">
      <NativeGeneratedImages items={[image]} />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /保存/ }));
  expect(add.mock.calls[0][0]).toBe('["codex","","session","one"]');
  expect(add.mock.calls[0][1][0].type).toBe("image/png");
});
it("keeps multiple actual generated images visible and ignores an absent image result", () => {
  render(
    <NativeGeneratedImages
      items={[
        image,
        { ...image, id: "second" },
        { ...image, id: "missing", result: "" },
      ]}
    />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(2);
});
it("retains an actual pending image next to completed pixels without inventing completion", () => {
  render(
    <NativeGeneratedImages
      running
      items={[
        image,
        { ...image, id: "pending", status: "in_progress", result: "" },
      ]}
    />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toBe(
    "activity.generatingImage",
  );
});
