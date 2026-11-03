import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { StreamingCodexMarkdown } from "./StreamingCodexMarkdown";

it("shows each code increment immediately without a finished fence or highlighter", () => {
  const view = render(<StreamingCodexMarkdown current={"```ts\nconst "} />);
  expect(view.container.textContent).toContain("const ");
  expect(view.container.querySelector("[data-streamdown]")).toBeNull();
  view.rerender(<StreamingCodexMarkdown current={"```ts\nconst value = 1;\n"} />);
  expect(view.container.textContent).toContain("const value = 1;");
  expect(view.container.querySelector("[data-streaming-live-tail] code")?.textContent).toContain(
    "const value = 1;",
  );
});

it("keeps an unfinished link visible beside already formatted text", () => {
  const view = render(
    <StreamingCodexMarkdown current={"**稳定标题**\n\n查看 [资料"} />,
  );
  expect(view.container.querySelector("strong")?.textContent).toBe("稳定标题");
  expect(view.container.textContent).toContain("[资料");
  expect(
    view.container.querySelector("[data-streaming-live-tail] [data-streamdown]"),
  ).toBeNull();
});

it("keeps an open mermaid fence and unfinished math as source", () => {
  const view = render(
    <StreamingCodexMarkdown current={"```mermaid\ngraph TD\n  A-->"} />,
  );
  expect(view.container.textContent).toContain("A-->");
  expect(view.container.querySelector(".mermaid, [data-native-mermaid]")).toBeNull();
  view.rerender(<StreamingCodexMarkdown current={"见 $E=mc"} />);
  expect(view.container.textContent).toContain("$E=mc");
  expect(view.container.querySelector(".katex")).toBeNull();
});
