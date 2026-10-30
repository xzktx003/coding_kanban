import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@session/components/common", () => ({ AddToTodo: () => null, CopyButton: () => null }));
vi.mock("./UserMessage", () => ({ UserMessage: ({ text, images }: { text: string; images?: string[] }) => <div>{text}{images?.map((src, index) => <img key={index} src={src} alt="用户图片" />)}</div> }));
vi.mock("./CCMessageContent", () => ({ CCMessageContent: () => null }));
vi.mock("./ExploredGroup", () => ({ ExploredGroup: () => null }));
import { CCMessage } from "./CCMessage";
import { buildMessageGroups } from "./group";

it("renders SDK array user text and image content instead of silently hiding the original question", () => {
  render(<CCMessage index={0} message={{ type: "user", uuid: "native", session_id: "session", content: [
    { type: "text", text: "original question" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
  ] }} />);
  expect(screen.getByText("original question")).toBeTruthy();
  expect(screen.getByRole("img", { name: "用户图片" }).getAttribute("src")).toBe("data:image/png;base64,AQID");
});
it("keeps cropped tool/user sources individually reachable rather than swallowing their detail action inside a silent group", () => {
  const values: any[] = [
    { type: "assistant", uuid: "tool", session_id: "session", truncated: true, historyDetail: { itemId: "tool-source" }, message: { content: [{ type: "tool_use", id: "call", name: "Read", input: {} }] } },
    { type: "user", uuid: "result", session_id: "session", truncated: true, historyDetail: { itemId: "result-source" }, content: [{ type: "tool_result", tool_use_id: "call", is_error: true, content: "preview" }] },
  ];
  expect(buildMessageGroups(values)).toEqual([{ kind: "message", msgIdx: 0 }, { kind: "message", msgIdx: 1 }]);
  render(<CCMessage index={1} message={values[1]} />);
  expect(screen.getByRole("button", { name: "查看完整内容" })).toBeTruthy();
});
