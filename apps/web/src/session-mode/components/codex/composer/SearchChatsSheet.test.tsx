import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import { useCodexStore } from "../stores/useCodexStore";
import { sessionTabSelect } from "@session/stores/sessionTabSelect";
import { SearchChatsSheet } from "./SearchChatsSheet";

vi.mock("@session/stores/sessionTabSelect", () => ({
  sessionTabSelect: vi.fn(),
}));

it("filters followed chats and switches to the chosen one", () => {
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "alpha", preview: "修复登录" },
      { kind: "codex", id: "beta", preview: "侧边聊天" },
    ],
  } as never);
  useCodexStore.setState({
    threads: [
      { id: "alpha", name: "修复登录" },
      { id: "beta", preview: "旧预览" },
    ],
  } as never);
  useSessionNameStore.setState({ names: { "codex:beta": "实验结果" } });
  render(<SearchChatsSheet onClose={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索并切换到聊天" }), {
    target: { value: "侧边" },
  });
  expect(screen.queryByRole("option", { name: "修复登录" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "实验结果" }));
  expect(sessionTabSelect).toHaveBeenCalledWith(
    expect.objectContaining({ id: "beta", kind: "codex" }),
  );
});
