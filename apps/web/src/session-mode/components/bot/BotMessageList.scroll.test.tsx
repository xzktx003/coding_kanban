import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { BotMessageList } from "./BotMessageList";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useBotUiStore } from "@session/stores/useBotUiStore";
import type { Bot } from "@session/services/apiAdapt/bots";
vi.mock("./useBotTimeline", () => ({
  useBotTimeline: () => ({ sections: [], error: "", retry: vi.fn() }),
}));
const scroll = vi.fn();
const bot = {
  id: "a",
  name: "助手A",
  title: null,
  avatar: "A",
  color: "#555",
} as Bot;
beforeEach(() => {
  scroll.mockClear();
  HTMLElement.prototype.scrollIntoView = scroll;
  useAcpStore.setState({
    entries: [{ id: "first", role: "agent", text: "旧记录" }],
    connecting: false,
  });
  useBotUiStore.setState({
    sessionByBot: { a: "session-a", b: "session-b" },
    runningByBot: {},
  });
});
test("reading old bot history keeps scroll after new entries and exposes return-to-latest", () => {
  const view = render(<BotMessageList bot={bot} />);
  const container =
    view.container.querySelector<HTMLElement>("[data-bot-history]")!;
  expect(container).toBeTruthy();
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "end" });
  scroll.mockClear();
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, writable: true, value: 200 },
  });
  fireEvent.scroll(container);
  act(() =>
    useAcpStore.setState({
      entries: [
        ...useAcpStore.getState().entries,
        { id: "new", role: "agent", text: "新消息" },
      ],
    }),
  );
  expect(scroll).not.toHaveBeenCalled();
  expect(container.scrollTop).toBe(200);
  fireEvent.click(screen.getByRole("button", { name: "回到最新" }));
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "end" });
  expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
});
test("switching bot/session resumes latest using nonanimated scrolling", () => {
  const view = render(<BotMessageList bot={bot} />);
  scroll.mockClear();
  view.rerender(<BotMessageList bot={{ ...bot, id: "b", name: "助手B" }} />);
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "end" });
  expect(
    scroll.mock.calls.some(([option]) => option?.behavior === "smooth"),
  ).toBe(false);
});

test("hidden bot output resumes latest only when the reader was following", async () => {
  const view = render(
    <div className="session-mode">
      <BotMessageList bot={bot} />
    </div>,
  );
  const root = view.container.querySelector<HTMLElement>(".session-mode")!;
  scroll.mockClear();
  await act(async () => {
    root.hidden = true;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "terminal" }),
    );
  });
  act(() =>
    useAcpStore.setState({
      entries: [
        ...useAcpStore.getState().entries,
        { id: "hidden", role: "agent", text: "隐藏期间输出" },
      ],
    }),
  );
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => {
    root.hidden = false;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "session" }),
    );
  });
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "end" });
  const container =
    view.container.querySelector<HTMLElement>("[data-bot-history]")!;
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, writable: true, value: 200 },
  });
  fireEvent.scroll(container);
  scroll.mockClear();
  await act(async () => {
    root.hidden = true;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "terminal" }),
    );
  });
  act(() =>
    useAcpStore.setState({
      entries: [
        ...useAcpStore.getState().entries,
        { id: "reading-hidden", role: "agent", text: "旧记录阅读不跳动" },
      ],
    }),
  );
  await act(async () => {
    root.hidden = false;
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: "session" }),
    );
  });
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "回到最新" })).toBeTruthy();
});
