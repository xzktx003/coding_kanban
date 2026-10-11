import { render, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { NativeWebsiteIcon } from "./NativeWebsiteIcon";
it("removes the globe only when the current favicon is loaded and restores it for a new URL", () => {
  const view = render(<NativeWebsiteIcon href="https://example.com/a" />);
  expect(view.container.querySelectorAll("svg")).toHaveLength(1);
  fireEvent.load(view.container.querySelector("img")!);
  expect(view.container.querySelectorAll("svg")).toHaveLength(0);
  expect(view.container.querySelector("img")?.style.opacity).toBe("1");
  view.rerender(<NativeWebsiteIcon href="https://other.example/b" />);
  expect(view.container.querySelectorAll("svg")).toHaveLength(1);
  expect(view.container.querySelector("img")?.style.opacity).toBe("0");
});
it("built-in brands do not request a remote favicon", () => {
  const view = render(
    <NativeWebsiteIcon href="https://docs.google.com/document/1" />,
  );
  expect(view.container.querySelectorAll("svg")).toHaveLength(1);
  expect(view.container.querySelector("img")).toBeNull();
});
