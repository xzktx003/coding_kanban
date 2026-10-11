import { fireEvent, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { NativeExternalLinkLabel } from "./NativeExternalLinkLabel";

it("keeps the native globe fallback until a website icon decodes and excludes it from copied text", () => {
  const { container } = render(
    <NativeExternalLinkLabel href="https://example.com">
      Open
    </NativeExternalLinkLabel>,
  );
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toContain(
    "url=https%3A%2F%2Fexample.com&size=32&drop_404_icon=true",
  );
  expect(image.style.opacity).toBe("0");
  expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(image.closest('[data-markdown-copy="exclude"]')).not.toBeNull();
  fireEvent.load(image);
  expect(image.style.opacity).toBe("1");
  expect(container.querySelector("svg")).toBeNull();
  fireEvent.error(image);
  expect(image.style.opacity).toBe("0");
  expect(container.querySelector("svg")).not.toBeNull();
});

it("does not request website icons for non-website links", () => {
  const { container } = render(
    <NativeExternalLinkLabel href="mailto:user@example.com">
      Email
    </NativeExternalLinkLabel>,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".codex-native-link-icon svg")).not.toBeNull();
  expect(container.textContent).toBe("Email");
});
it.each([
  "https://github.com/a/b/pull/1",
  "http://github.com/a/b",
  "https://api.github.com/repos/a/b",
])(
  "uses the native built-in GitHub icon independently of the PR gate: %s",
  (href) => {
    const { container } = render(
      <NativeExternalLinkLabel href={href}>Review</NativeExternalLinkLabel>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 20 20",
    );
  },
);

it("a changed URL does not inherit the previous decoded favicon", () => {
  const view = render(
    <NativeExternalLinkLabel href="https://example.com/a">
      Open
    </NativeExternalLinkLabel>,
  );
  fireEvent.load(view.container.querySelector("img")!);
  view.rerender(
    <NativeExternalLinkLabel href="https://other.example/b">
      Open
    </NativeExternalLinkLabel>,
  );
  expect(view.container.querySelector("img")?.style.opacity).toBe("0");
  expect(view.container.querySelector("svg")).not.toBeNull();
});
