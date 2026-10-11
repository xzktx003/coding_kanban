import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeCodeFence } from "./NativeCodeFence";

vi.mock("./nativeFenceHighlight", () => ({
  nativeFenceHighlight: { highlight: () => null },
}));
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 20"><defs><rect id="shape" width="40" height="20"/></defs><use xlink:href="#shape"/><text>图形</text></svg>';

it.each(["svg", "xml", "html"])(
  "previews native %s SVG fences without placing SVG nodes in the document",
  (language) => {
    const { container } = render(
      <NativeCodeFence code={svg} language={language} />,
    );
    const image = screen.getByRole("img", { name: "由助手生成的图像" });
    expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(container.querySelector("use")).toBeNull();
    expect(screen.queryByRole("button", { name: /自动换行/ })).toBeNull();
  },
);

it("copies the untouched SVG source rather than its browser-normalized preview", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<NativeCodeFence code={svg} language="svg" />);
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(svg));
  expect(await screen.findByRole("button", { name: "已复制" })).toBeTruthy();
});

it("keeps other XML/HTML as source and switches back from image when the content changes", () => {
  const view = render(<NativeCodeFence code={svg} language="html" />);
  expect(screen.getByRole("img")).toBeTruthy();
  view.rerender(<NativeCodeFence code="<main>hello</main>" language="html" />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("<main>hello</main>")).toBeTruthy();
  expect(screen.getByRole("button", { name: "启用自动换行" })).toBeTruthy();
});
