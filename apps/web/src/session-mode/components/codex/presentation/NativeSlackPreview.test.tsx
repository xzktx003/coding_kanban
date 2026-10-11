import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  NativeSlackPreview,
  NativeSlackPreviewHost,
  type NativeSlackPreviewTransport,
} from "./NativeSlackPreview";
const href = "https://team.slack.com/team/U123";
const response = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        result: "User ID: U123\nReal Name: Alice\nTitle: Engineer",
      }),
    },
  ],
};
afterEach(() => vi.useRealTimers());
const show = (host: NativeSlackPreviewTransport) =>
  render(
    <NativeSlackPreviewHost.Provider value={host}>
      <NativeSlackPreview href={href}>
        <a href={href}>Slack</a>
      </NativeSlackPreview>
    </NativeSlackPreviewHost.Provider>,
  );
it("loads matched, bounded data on keyboard focus without changing the target", async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => response);
  show({ identity: () => "account:host:server:tool:U123", read });
  fireEvent.focus(screen.getByText("Slack"));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("Alice")).toBeTruthy();
  expect(screen.getByText("Engineer")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "打开网站" }).getAttribute("href"),
  ).toBe(href);
  expect(read).toHaveBeenCalledOnce();
  const card = screen.getByRole("tooltip");
  const trigger = screen.getByText("Slack");
  expect(card.contains(screen.getByText("Alice"))).toBe(true);
  expect(card.contains(screen.getByRole("link", { name: "打开网站" }))).toBe(
    true,
  );
  expect(trigger.getAttribute("aria-describedby")).toBe(card.id);
  expect(card.id).not.toBe("");
  fireEvent.keyDown(trigger, { key: "Tab" });
  expect(document.activeElement).toBe(
    screen.getByRole("link", { name: "打开网站" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledOnce();
  expect(screen.queryByRole("tooltip")).toBeNull();
});
it("rejects a late result when the connection changes while reading", async () => {
  vi.useFakeTimers();
  let identity = "account-a",
    finish!: (value: unknown) => void;
  const read = vi.fn(() => new Promise((resolve) => (finish = resolve)));
  show({ identity: () => identity, read });
  fireEvent.focus(screen.getByText("Slack"));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  identity = "account-b";
  await act(async () => finish(response));
  expect(screen.queryByText("Alice")).toBeNull();
});
it("aborts on unmount and prevents displaying an obsolete result", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal, finish!: (value: unknown) => void;
  const view = show({
    identity: () => "account-a",
    read: (_target, s) => {
      signal = s;
      return new Promise((resolve) => (finish = resolve));
    },
  });
  fireEvent.focus(screen.getByText("Slack"));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(response));
  expect(screen.queryByText("Alice")).toBeNull();
});
it("clears visible metadata on an identity notification", async () => {
  vi.useFakeTimers();
  let notify!: () => void;
  show({
    identity: () => "account-a",
    read: async () => response,
    subscribe: (callback) => {
      notify = callback;
      return () => {};
    },
  });
  fireEvent.focus(screen.getByText("Slack"));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("Alice")).toBeTruthy();
  act(() => notify());
  expect(screen.queryByText("Alice")).toBeNull();
});
it.each([false, true])(
  "prefetches after 200ms and cancels pending hover reads on Escape (%s)",
  async (escape) => {
    vi.useFakeTimers();
    const read = vi.fn(async () => response);
    show({ identity: () => "account-a", read });
    fireEvent.pointerEnter(screen.getByText("Slack"), {
      pointerType: "mouse",
      buttons: 0,
    });
    await act(async () => vi.advanceTimersByTimeAsync(199));
    expect(read).not.toHaveBeenCalled();
    if (escape) fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(read).toHaveBeenCalledTimes(escape ? 0 : 1);
  },
);
it("does not reread an open preview on reconnect, but reloads a changed identity", async () => {
  vi.useFakeTimers();
  let notify!: (options?: { reload?: boolean }) => void;
  const read = vi.fn(async () => response);
  show({
    identity: () => "account-a",
    read,
    subscribe: (callback) => {
      notify = callback;
      return () => {};
    },
  });
  fireEvent.focus(screen.getByText("Slack"));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledOnce();
  act(() => notify({ reload: false }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledOnce();
  act(() => notify({ reload: true }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledTimes(2);
});
it("keeps a failed read unavailable for the native one-minute stale window", async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => {
    throw new Error("tool unavailable");
  });
  show({ identity: () => "account-a", read });
  const trigger = screen.getByText("Slack");
  fireEvent.focus(trigger);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledOnce();
  fireEvent.blur(trigger);
  fireEvent.focus(trigger);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(60_001));
  fireEvent.blur(trigger);
  fireEvent.focus(trigger);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledTimes(2);
});
