import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { BotComposer } from "./BotComposer";
import { useBotUiStore } from "@session/stores/useBotUiStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import type { Bot } from "@session/services/apiAdapt/bots";
const rpc = vi.hoisted(() => ({
  prompt: vi.fn(),
  cancel: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpPrompt: rpc.prompt,
  acpCancel: rpc.cancel,
}));
vi.mock("@session/components/acp/useAcpAgents", () => ({
  useAcpAgents: () => [{ id: "keke", local: true }],
}));
vi.mock("./useBotSession", () => ({
  useBotSession: () => ({ open: rpc.open }),
}));
vi.mock("./BotToolsMenu", () => ({ BotToolsMenu: () => null }));
const a = { id: "a", name: "中文助手" } as Bot;
const b = { id: "b", name: "另外助手" } as Bot;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.prompt.mockResolvedValue(undefined);
  rpc.cancel.mockResolvedValue(undefined);
  useBotUiStore.setState({
    selectedBotId: "a",
    connectionByBot: { a: "conn-a", b: "conn-b" },
    sessionByBot: { a: "session-a", b: "session-b" },
    runningByBot: {},
    savingSettingsByBot: {},
    mcpChangedByBot: {},
    draftByBot: {},
    composerErrorByBot: {},
    sendingByBot: {},
    stoppingByBot: {},
    kekeSpawnFailed: false,
  });
  useAcpStore.setState({
    connectionId: "conn-a",
    sessionId: "session-a",
    running: false,
    connecting: false,
    entries: [],
  });
});
test("named input/send preserve failed draft and isolate draft per bot", async () => {
  rpc.prompt.mockRejectedValueOnce(new Error("503 fixture"));
  const view = render(<BotComposer bot={a} />);
  fireEvent.change(screen.getByRole("textbox", { name: "给中文助手的消息" }), {
    target: { value: "保留草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox").getAttribute("aria-label")).toBe(
    "给中文助手的消息",
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "保留草稿",
  );
  act(() => useBotUiStore.setState({ selectedBotId: "b" }));
  view.rerender(<BotComposer bot={b} />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "B草稿" } });
  act(() => useBotUiStore.setState({ selectedBotId: "a" }));
  view.rerender(<BotComposer bot={a} />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "保留草稿",
  );
});
test("successful send does not clear newer typing", async () => {
  let finish!: () => void;
  rpc.prompt.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  render(<BotComposer bot={a} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "已发送" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "新输入" },
  });
  await act(async () => finish());
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "新输入",
  );
});
test("stop failure keeps running, is retryable, and successful stale stop never clears another bot", async () => {
  let finish!: () => void;
  rpc.cancel
    .mockRejectedValueOnce(new Error("cancel failed"))
    .mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
  useBotUiStore.setState({ runningByBot: { a: true } });
  useAcpStore.setState({ running: true });
  const view = render(<BotComposer bot={a} />);
  fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
  await screen.findByRole("alert");
  expect(useBotUiStore.getState().runningByBot.a).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
  expect(screen.getByRole("button", { name: "正在停止" })).toHaveProperty(
    "disabled",
    true,
  );
  act(() => {
    useBotUiStore.setState({
      selectedBotId: "b",
      runningByBot: { a: true, b: true },
    });
    useAcpStore.setState({
      connectionId: "conn-b",
      sessionId: "session-b",
      running: true,
    });
  });
  view.rerender(<BotComposer bot={b} />);
  await act(async () => finish());
  expect(rpc.cancel).toHaveBeenLastCalledWith("conn-a", "session-a");
  expect(useAcpStore.getState().running).toBe(true);
  expect(useBotUiStore.getState().runningByBot.b).toBe(true);
});
