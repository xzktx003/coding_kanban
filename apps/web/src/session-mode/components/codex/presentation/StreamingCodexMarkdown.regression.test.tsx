import { act, render, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it } from "vitest";
import { StreamingCodexMarkdown } from "./StreamingCodexMarkdown";
import { CodexMarkdown } from "./CodexMarkdown";

it.each([
  ["reference", "查看 [资料]", "[来源]"],
  ["footnote", "查看 ", "[^1]"],
  ["code index", "```js\nconst value = matrix[i]", "[j];"],
])(
  "keeps previously formatted text when streaming a %s",
  async (_, before, delta) => {
    const prefix = "**稳定标题**\n\n";
    const view = render(<StreamingCodexMarkdown current={prefix + before} />);
    await waitFor(() =>
      expect(view.container.querySelector("strong")?.textContent).toBe(
        "稳定标题",
      ),
    );
    view.rerender(<StreamingCodexMarkdown current={prefix + before + delta} />);
    await waitFor(() =>
      expect(view.container.querySelector("strong")?.textContent).toBe(
        "稳定标题",
      ),
    );
    expect(
      view.container.querySelector("[data-streaming-markdown-plain]"),
    ).toBeNull();
    expect(view.container.textContent).not.toContain("**稳定标题**");
  },
);

it("defers an unfinished link without hiding already formatted content", async () => {
  const view = render(
    <StreamingCodexMarkdown current={"**标题**\n\n查看 [资料"} />,
  );
  await waitFor(() =>
    expect(view.container.querySelector("strong")?.textContent).toBe("标题"),
  );
  expect(view.container.textContent).toContain("[资料");
  view.rerender(
    <StreamingCodexMarkdown current={"**标题**\n\n查看 [资料][来源]"} />,
  );
  await waitFor(() =>
    expect(view.container.textContent).toContain("[资料][来源]"),
  );
  expect(view.container.querySelector("strong")?.textContent).toBe("标题");
});

it("does not expose both old tail and new stable text at the 8192-character handoff", async () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  const first =
    "**StableMarker**\n\n" + "x".repeat(8192 - "**StableMarker**\n\n".length);
  try {
    await act(async () =>
      root.render(<StreamingCodexMarkdown current={first.slice(0, -1)} />),
    );
    expect(element.querySelectorAll("strong")).toHaveLength(1);
    flushSync(() =>
      root.render(<StreamingCodexMarkdown segments={[first]} current="y" />),
    );
    expect(element.querySelectorAll("strong")).toHaveLength(1);
    expect(element.textContent?.match(/StableMarker/g)).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

it("keeps an already formatted prefix when a long unfinished block crosses the tail budget", async () => {
  const first = "**标题**" + "x".repeat(8192 - "**标题**".length);
  const view = render(
    <StreamingCodexMarkdown segments={[first]} current={"x".repeat(8191)} />,
  );
  await waitFor(() =>
    expect(view.container.querySelector("strong")?.textContent).toBe("标题"),
  );
  view.rerender(
    <StreamingCodexMarkdown segments={[first, "x".repeat(8192)]} current="y" />,
  );
  expect(view.container.querySelector("strong")?.textContent).toBe("标题");
  expect(view.container.textContent?.endsWith("y")).toBe(true);
});

it("resolves the full reference using the existing final renderer", async () => {
  const value = "**标题**\n\n查看 [资料][来源]\n\n[来源]: https://example.test";
  const view = render(<CodexMarkdown value={value} />);
  await waitFor(() =>
    expect(view.container.querySelector("strong")?.textContent).toBe("标题"),
  );
  const link = view.container.querySelector("a");
  expect(link?.textContent).toBe("资料");
  expect(new URL(link!.href).hostname).toBe("example.test");
});

it("keeps rendering after a reference definition enters an immutable segment", async () => {
  const segment = "**标题**\n\n[来源]: https://example.test\n\n";
  const view = render(
    <StreamingCodexMarkdown segments={[segment]} current="**后续**" />,
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll("strong")).toHaveLength(2),
  );
  expect(
    view.container.querySelector("[data-streaming-markdown-plain]"),
  ).toBeNull();
});

it("shows unfinished bold markers immediately instead of waiting to close them", () => {
  const view = render(<StreamingCodexMarkdown current="未完成的 **加粗" />);
  expect(view.container.textContent).toContain("未完成的 **加粗");
  expect(view.container.querySelector("strong")).toBeNull();
});

it("does not create an unsafe link when resolving a final reference", async () => {
  const view = render(
    <CodexMarkdown value={"[危险][来源]\n\n[来源]: javascript:alert(1)"} />,
  );
  await waitFor(() => expect(view.container.textContent).toContain("危险"));
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it("resolves a completed footnote and keeps the earlier formatted text", async () => {
  const view = render(
    <CodexMarkdown value={"**标题**\n\n正文[^1]\n\n[^1]: 注释内容"} />,
  );
  await waitFor(() =>
    expect(view.container.querySelector("strong")?.textContent).toBe("标题"),
  );
  expect(view.container.textContent).toContain("注释内容");
  expect(
    [...view.container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    ),
  ).toContain("#user-content-fn-1");
});
