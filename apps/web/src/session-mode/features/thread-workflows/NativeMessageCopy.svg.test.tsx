import { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UserMessageItem } from "@session/components/codex/items/UserMessageItem";
import { CodexMarkdown } from "@session/components/codex/presentation/CodexMarkdown";
import { NativeCodeFence } from "@session/components/codex/presentation/NativeCodeFence";
import { nativeMessageClipboard } from "@session/components/codex/presentation/nativeMessageClipboard";
import { NativeMessageCopy } from "./NativeMessageCopy";

const clipboard = vi.hoisted(() => ({
  write: vi.fn(async (_text: string, _html?: string) => {}),
}));
vi.mock(
  "@session/components/codex/presentation/nativeMarkdownClipboard",
  () => ({ writeNativeMarkdownClipboard: clipboard.write }),
);
vi.mock("@session/components/codex/presentation/nativeFenceHighlight", () => ({
  nativeFenceHighlight: { highlight: () => null },
}));
afterEach(() => {
  clipboard.write.mockClear();
});

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 10"><use xlink:href="#shape"/><script>window.svgMustStayInert = true</script></svg>';
const source = (language: string) =>
  `Before\n\n\`\`\`${language}\n${svg}\n\`\`\`\n\nAfter`;
function expectRawCode(html: string | undefined, expected = svg) {
  const copy = document.createElement("div");
  copy.innerHTML = html!;
  expect(copy.querySelector("pre code")?.textContent).toBe(expected);
  expect(copy.querySelector("svg, script")).toBeNull();
}

it.each(["svg", "xml", "html"])(
  "copies original %s preview source through the user message action",
  async (language) => {
    const { container } = render(
      <UserMessageItem
        content={[{ type: "text", text: source(language), text_elements: [] }]}
        threadId="owner"
        turnId="turn"
        itemId="item"
      />,
    );
    expect(container.querySelector(".codex-native-svg-preview")).toBeTruthy();
    expect(
      container.querySelector("svg script, .codex-user-bubble script"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
    await waitFor(() => expect(clipboard.write).toHaveBeenCalledTimes(1));
    const [plain, html] = clipboard.write.mock.calls[0];
    expect(plain).toContain(svg);
    expectRawCode(html);
  },
);

it("keeps original SVG source in assistant plain and rich message payloads", async () => {
  function Message() {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <>
        <div ref={ref}>
          <CodexMarkdown value={source("svg")} />
        </div>
        <NativeMessageCopy
          kind="assistant"
          text={source("svg")}
          contentRef={ref}
        />
      </>
    );
  }
  render(<Message />);
  fireEvent.click(screen.getByRole("button", { name: "复制回复" }));
  await waitFor(() => expect(clipboard.write).toHaveBeenCalledTimes(1));
  const [plain, html] = clipboard.write.mock.calls[0];
  expect(plain).toBe(source("svg"));
  expectRawCode(html);
});

it("updates the raw clipboard source when the preview content changes", () => {
  const view = render(<NativeCodeFence code={svg} language="svg" />);
  const next = '<svg viewBox="0 0 10 10"><text>new owner content</text></svg>';
  view.rerender(<NativeCodeFence code={next} language="html" />);
  const payload = nativeMessageClipboard(view.container)!;
  expect(payload.text).toBe(next);
  expectRawCode(payload.html, next);
});

it("releases the preview source attribute when a fence returns to ordinary highlighted code", () => {
  const view = render(<NativeCodeFence code={svg} language="svg" />);
  view.rerender(
    <NativeCodeFence code="exact ordinary source" language="text" />,
  );
  expect(
    view.container
      .querySelector('[data-markdown-copy="code-block"]')
      ?.hasAttribute("data-markdown-copy-text"),
  ).toBe(false);
  expect(nativeMessageClipboard(view.container)?.text).toBe(
    "exact ordinary source",
  );
});
