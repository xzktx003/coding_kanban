import { expect, it } from "vitest";
import { emptySendGuard } from "./emptySendGuard";

it("asks for a workspace when an empty new chat has nowhere to run", () => {
  expect(emptySendGuard({ hasContent: false, threadId: null, workspace: null })).toEqual({
    title: "无法发送消息",
    message: "请先打开文件夹或工作区",
  });
});

it("asks for a workspace even when the new chat already has content", () => {
  expect(emptySendGuard({ hasContent: true, threadId: null, workspace: null })).toEqual({
    title: "无法发送消息",
    message: "请先打开文件夹或工作区",
  });
});

it("does not interrupt a message that already has a workspace or thread", () => {
  expect(emptySendGuard({ hasContent: false, threadId: null, workspace: "/owned/project" })).toBeNull();
  expect(emptySendGuard({ hasContent: false, threadId: "existing", workspace: null })).toBeNull();
});
