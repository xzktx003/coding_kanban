import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderHistoryDetail } from "./ProviderHistoryDetail";
import { usePairingStore } from "@session/stores/usePairingStore";

const harness = vi.hoisted(() => ({
  visible: true,
  revision: 0,
  onScopeReset: undefined as undefined | (() => void),
}));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => harness.visible,
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: (options: { onResync?(): void }) => {
    harness.onScopeReset = options.onResync;
    return () => {
      harness.onScopeReset = undefined;
    };
  },
}));
vi.mock("@session/services/codexOperationScope", () => ({
  captureCodexOperationScope: () => ({ revision: harness.revision }),
  isCodexOperationScopeCurrent: (scope: { revision: number }) =>
    scope.revision === harness.revision,
  startCodexOperationScopeSync: () => () => {},
}));
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  harness.visible = true;
  harness.revision = 0;
  usePairingStore.setState({ desktops: [], selectedHost: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const envelope = (
  text: string,
  nextOffset: number | null,
  itemRevision = "a".repeat(64),
) =>
  new Response(
    JSON.stringify({
      text,
      nextOffset,
      itemRevision,
      revision: "opaque",
      format: "json",
    }),
    { headers: { "content-type": "application/json" } },
  );

it("only reads on explicit expand, preserves the exact owner and replaces rather than accumulates detail pages", async () => {
  fetcher
    .mockResolvedValueOnce(envelope("first-part", 10))
    .mockResolvedValueOnce(envelope("second-part", null));
  render(
    <ProviderHistoryDetail
      provider="cc"
      sessionId="original-session"
      itemId="source-item"
    />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await screen.findByText("first-part");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    session_id: "original-session",
    item_id: "source-item",
    offset: 0,
    limit: 65536,
  });
  fireEvent.click(screen.getByRole("button", { name: "下一部分" }));
  await screen.findByText("second-part");
  expect(screen.queryByText("first-part")).toBeNull();
  expect(JSON.parse(fetcher.mock.calls[1][1].body).offset).toBe(10);
  expect(screen.queryByRole("button", { name: "下一部分" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭完整内容" }));
  expect(screen.queryByText("second-part")).toBeNull();
});

it("rejects a changed source between parts and requires an explicit fresh read", async () => {
  fetcher
    .mockResolvedValueOnce(envelope("old-source", 10))
    .mockResolvedValueOnce(envelope("new-source", null, "b".repeat(64)));
  render(
    <ProviderHistoryDetail
      provider="acp"
      sessionId="session"
      itemId="tool-source"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await screen.findByText("old-source");
  fireEvent.click(screen.getByRole("button", { name: "下一部分" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("内容已更新");
  expect(screen.queryByText("old-source")).toBeNull();
  expect(screen.queryByText("new-source")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("aborts and releases a pending part on a same-value scope reset or owner change", async () => {
  let resolve!: (value: Response) => void;
  fetcher.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const view = render(
    <ProviderHistoryDetail provider="cc" sessionId="first" itemId="item" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  act(() => harness.onScopeReset?.());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(envelope("late-owner-body", null));
  });
  expect(screen.queryByText("late-owner-body")).toBeNull();
  view.rerender(
    <ProviderHistoryDetail provider="cc" sessionId="second" itemId="item" />,
  );
  expect(screen.queryByRole("region", { name: "完整原始内容" })).toBeNull();
});

it("rejects oversized detail transport before JSON parsing and never shows its payload", async () => {
  fetcher.mockResolvedValue(envelope("oversized-payload".repeat(10_000), null));
  render(
    <ProviderHistoryDetail
      provider="acp"
      sessionId="session"
      itemId="source"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("读取预算");
  expect(screen.queryByText(/oversized-payload/)).toBeNull();
});

it("closes and releases the shown source when its provider pane is hidden or the paired backend changes", async () => {
  fetcher.mockImplementation(() =>
    Promise.resolve(envelope("visible-detail", null)),
  );
  const view = render(
    <ProviderHistoryDetail
      provider="acp"
      sessionId="session"
      itemId="source"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await screen.findByText("visible-detail");
  act(() =>
    usePairingStore.setState({
      desktops: [
        {
          name: "other",
          host: "other-device",
          port: 3333,
          token: "fixture-only-token",
        },
      ],
      selectedHost: "other-device",
    }),
  );
  expect(screen.queryByText("visible-detail")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.rerender(
    <ProviderHistoryDetail
      provider="acp"
      sessionId="new-device-session"
      itemId="source"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await screen.findByText("visible-detail");
  harness.visible = false;
  view.rerender(
    <ProviderHistoryDetail
      provider="acp"
      sessionId="new-device-session"
      itemId="source"
    />,
  );
  expect(screen.queryByText("visible-detail")).toBeNull();
});

it("does not capture a new account scope for the old source when moving to the next text page", async () => {
  fetcher
    .mockResolvedValueOnce(envelope("original page", 10))
    .mockResolvedValueOnce(envelope("wrong account page", null));
  render(
    <ProviderHistoryDetail
      provider="cc"
      sessionId="original"
      itemId="source"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await screen.findByText("original page");
  harness.revision++;
  fireEvent.click(screen.getByRole("button", { name: "下一部分" }));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "完整原始内容" })).toBeNull(),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects an old preview's first gesture after a same-value account invalidation", async () => {
  fetcher.mockResolvedValue(envelope("body from the new account", null));
  render(
    <ProviderHistoryDetail provider="cc" sessionId="original" itemId="source" />,
  );
  harness.revision++;
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await act(async () => {});
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByText("body from the new account")).toBeNull();
});

it("rejects an old preview's first gesture after the paired token changes at the same endpoint", async () => {
  usePairingStore.setState({
    desktops: [{ name: "fixture", host: "fixture", port: 3333, token: "old" }],
    selectedHost: "fixture",
  });
  fetcher.mockResolvedValue(envelope("wrong token source", null));
  render(
    <ProviderHistoryDetail provider="acp" sessionId="original" itemId="source" />,
  );
  act(() => usePairingStore.setState({
    desktops: [{ name: "fixture", host: "fixture", port: 3333, token: "new" }],
  }));
  fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
  await act(async () => {});
  expect(fetcher).not.toHaveBeenCalled();
});

it("a late source confirmation failure cannot disable or label a different preview", async () => {
  let reject!: (error: Error) => void;
  const confirm = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const view = render(<ProviderHistoryDetail provider="cc" sessionId="first" itemId="item" sourceRow={{}} sourceOwner="cc:first" onConfirmSource={confirm} />);
  fireEvent.click(screen.getByRole("button", { name: "重新核对来源" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  view.rerender(<ProviderHistoryDetail provider="cc" sessionId="second" itemId="item" sourceRow={{}} sourceOwner="cc:second" onConfirmSource={confirm} />);
  expect(screen.getByRole("button", { name: "重新核对来源" }).hasAttribute("disabled")).toBe(false);
  await act(async () => reject(new Error("first source failed")));
  expect(screen.queryByText("first source failed")).toBeNull();
  expect(screen.getByRole("button", { name: "重新核对来源" }).hasAttribute("disabled")).toBe(false);
});

it("hiding a source cancels only its confirmation and permits a new explicit attempt on return", async () => {
  let signal!: AbortSignal, reject!: (error: Error) => void;
  const confirm = vi.fn((_scope, capturedSignal: AbortSignal) => {
    signal = capturedSignal;
    return new Promise<void>((_, fail) => { reject = fail; });
  });
  const props = { provider: "cc" as const, sessionId: "same", itemId: "item", sourceRow: {}, sourceOwner: "cc:same", onConfirmSource: confirm };
  const view = render(<ProviderHistoryDetail {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "重新核对来源" }));
  expect(signal.aborted).toBe(false);
  harness.visible = false;
  view.rerender(<ProviderHistoryDetail {...props} />);
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error("hidden old request")));
  harness.visible = true;
  view.rerender(<ProviderHistoryDetail {...props} />);
  expect(screen.queryByText("hidden old request")).toBeNull();
  expect(screen.getByRole("button", { name: "重新核对来源" }).hasAttribute("disabled")).toBe(false);
});
