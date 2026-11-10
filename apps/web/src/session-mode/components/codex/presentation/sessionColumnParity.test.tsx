import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentMessageItem } from "../items/AgentMessageItem";
import { NativeToolDisclosure } from "../items/NativeToolDisclosure";
import { ReasoningSummaryItem } from "../items/ReasoningSummaryItem";
import { UserMessageItem } from "../items/UserMessageItem";
import { ComposerEditor } from "../composer/editor/ComposerEditor";
import { CodexMarkdown } from "./CodexMarkdown";
import { NativeCodeFence } from "./NativeCodeFence";

vi.mock("../thread/inspection", () => ({
  useTranscriptInspection: () => false,
}));
vi.mock("@session/hooks/useWindowFocus", () => ({
  useWindowFocus: () => true,
}));
vi.mock("../composer/mentions", () => ({
  useMentionItems: () => ({ items: [] }),
}));
vi.mock("../composer/editor/MentionTypeaheadPlugin", () => ({
  MentionTypeaheadPlugin: () => null,
}));
vi.mock("../thread/rowState", () => ({
  useTranscriptState: (_key: string, initial: boolean) => [initial, () => {}],
}));

it("mounts one session column body and composer with the plugin surface markers", () => {
  const view = render(
    <div data-session-column>
      <UserMessageItem content={[{ type: "text", text: "看一下这个函数", text_elements: [] }]} />
      <AgentMessageItem text={"结果如下\n\n| 名称 | 值 |\n| --- | --- |\n| a | 1 |"} />
      <NativeCodeFence code="const value = 1;" language="typescript" />
      <NativeToolDisclosure summary="读取文件">body</NativeToolDisclosure>
      <ReasoningSummaryItem summary={["**标题**\n\n先看范围"]} />
      <ComposerEditor value="" onChange={() => {}} onSubmit={() => {}} placeholder="可向 Codex 询问任何问题。输入 @ 使用插件或提及文件" />
    </div>,
  );
  expect(view.container.querySelector("[data-message-author=user]")?.textContent).toContain(
    "看一下这个函数",
  );
  expect(view.container.querySelector("[data-message-author=assistant]")?.textContent).toContain(
    "结果如下",
  );
  expect(view.container.querySelector("[data-streamdown=code-block] code")?.textContent).toContain(
    "const value = 1;",
  );
  expect(view.container.querySelector("[data-tool-row]")?.textContent).toContain("读取文件");
  expect(screen.getByRole("button", { name: /已完成思考/ })).toBeTruthy();
  const composer = view.container.querySelector("[data-composer-input]");
  expect(composer?.textContent).toContain("可向 Codex 询问任何问题");
});

it("keeps a finished transcript link on the completed markdown path", async () => {
  const view = render(
    <CodexMarkdown value={"查看 [资料](https://example.com/notes)"} />,
  );
  const link = await screen.findByRole("link", { name: "资料" });
  expect(link.getAttribute("href")).toBe("https://example.com/notes");
  expect(view.container.querySelector("[data-streaming-live-tail]")).toBeNull();
});

it("renders a finished markdown table through the completed assistant message", async () => {
  const view = render(
    <AgentMessageItem text={"| 名称 | 值 |\n| --- | --- |\n| a | 1 |"} />,
  );
  expect(await screen.findByRole("columnheader", { name: "名称" })).toBeTruthy();
  expect(view.container.querySelector("[data-message-author=assistant] table")).toBeTruthy();
});
