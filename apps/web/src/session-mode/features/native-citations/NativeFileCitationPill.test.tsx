import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NativeFileCitationPill } from "./NativeFileCitationPill";
const language = vi.hoisted(() => ({ value: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: language.value } }),
}));
beforeEach(() => {
  language.value = "en";
});

it("opens the captured owner and entire range only after an explicit activation", () => {
  const onOpen = vi.fn();
  const owner = { threadId: "owner", cwd: "/project-a", hostId: "local" };
  render(
    <NativeFileCitationPill
      citation={{
        kind: "file",
        path: "src/owned.ts",
        lineStart: 12,
        lineEnd: 18,
      }}
      owner={owner}
      onOpen={onOpen}
    />,
  );
  const button = screen.getByRole("button", { name: "owned.ts (lines 12-18)" });
  expect(onOpen).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(button);
  fireEvent.mouseEnter(button);
  fireEvent.focus(button);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(
    { path: "/project-a/src/owned.ts", line: 12, endLine: 18 },
    owner,
  );
  expect(button.getAttribute("data-markdown-copy-text")).toBe(
    "src/owned.ts:12-18",
  );
  expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});
it.each(["Enter", " "])(
  "supports explicit %s keyboard activation without bubbling",
  (key) => {
    const onOpen = vi.fn(),
      parent = vi.fn();
    render(
      <div onClick={parent} onKeyDown={parent} onKeyUp={parent}>
        <NativeFileCitationPill
          citation={{ kind: "file", path: "/project/file.ts", lineStart: 3 }}
          owner={{ threadId: "source", cwd: "/project" }}
          onOpen={onOpen}
        />
      </div>,
    );
    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key });
    fireEvent.keyUp(button, { key });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  },
);
it("does not redirect a detached old message to the active workspace", () => {
  const onOpen = vi.fn();
  const view = render(
    <NativeFileCitationPill
      citation={{
        kind: "file",
        path: "literal%23owned:42.ts",
        lineStart: 2,
        lineEnd: 4,
      }}
      owner={{ threadId: "old", cwd: "/old" }}
      onOpen={onOpen}
    />,
  );
  view.rerender(
    <div data-active-cwd="/new">
      <NativeFileCitationPill
        citation={{
          kind: "file",
          path: "literal%23owned:42.ts",
          lineStart: 2,
          lineEnd: 4,
        }}
        owner={{ threadId: "old", cwd: "/old" }}
        onOpen={onOpen}
      />
    </div>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(
    { path: "/old/literal%23owned:42.ts", line: 2, endLine: 4 },
    { threadId: "old", cwd: "/old" },
  );
});
it("preserves relative citations as disabled text until owner cwd is known", () => {
  const onOpen = vi.fn();
  render(
    <NativeFileCitationPill
      citation={{ kind: "file", path: "src/file.ts" }}
      owner={{ threadId: "old" }}
      onOpen={onOpen}
    />,
  );
  const button = screen.getByRole("button");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.getAttribute("tabindex")).toBe("-1");
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "Enter" });
  expect(onOpen).not.toHaveBeenCalled();
});
it("uses native Chinese range labels and basename for a file label", () => {
  language.value = "zh-CN";
  render(
    <NativeFileCitationPill
      citation={{
        kind: "file",
        path: "/owned/file.ts",
        lineStart: 3,
        lineEnd: 7,
        label: "Ignore a cloud title",
      }}
      owner={{}}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByRole("button").textContent).toBe("file.ts (第 3-7 行)");
});
it("renders an ordinary external source anchor without invoking workspace actions", () => {
  const onOpen = vi.fn();
  render(
    <NativeFileCitationPill
      citation={{
        kind: "external",
        path: "https://example.invalid/source",
        label: "Source",
      }}
      owner={{ threadId: "old", cwd: "/old" }}
      onOpen={onOpen}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Source" }).getAttribute("href"),
  ).toBe("https://example.invalid/source");
  expect(screen.queryByRole("button")).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
});
it("never exposes a clickable unsafe target even when component data was forged", () => {
  const onOpen = vi.fn();
  render(
    <NativeFileCitationPill
      citation={{
        kind: "external",
        path: "javascript:alert(1)",
        label: "Unsafe",
      }}
      owner={{}}
      onOpen={onOpen}
    />,
  );
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
});
