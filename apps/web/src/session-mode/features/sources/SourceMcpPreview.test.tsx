import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SourceMcpPreview } from "./SourceMcpPreview";
import { openEventStream } from "@session/lib/eventStream";
import { sourcePreview } from "./sourcePreview";
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: vi.fn(() => () => {}),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(openEventStream).mockClear();
});
const call = {
  threadId: "owner",
  turnId: "turn",
  itemId: "item",
  tool: "lookup",
  status: "completed",
};
const response = () =>
  new Response(
    JSON.stringify({
      threadId: "owner",
      turnId: "turn",
      itemId: "item",
      item: {
        id: "item",
        type: "mcpToolCall",
        server: "docs",
        tool: "lookup",
        status: "completed",
        arguments: { query: "lookup input" },
        result: { content: [{ type: "text", text: "result text" }] },
      },
    }),
  );
it("reads only the exact MCP item and releases the displayed preview on account invalidation", async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _options?: RequestInit) => response(),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<SourceMcpPreview call={call} />);
  await screen.findByText(/lookup input/);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
    threadId: "owner",
    turnId: "turn",
    itemId: "item",
    expectedType: "mcpToolCall",
  });
  const onEvent = vi.mocked(openEventStream).mock.calls[0][0].onEvent;
  act(() =>
    onEvent({
      seq: 1,
      event: "codex:notification",
      payload: { method: "account/updated", params: {} },
    }),
  );
  expect(screen.queryByText(/lookup input/)).toBeNull();
  expect(screen.getByText(/连接或账号已变化/)).toBeTruthy();
});
it("cancels the owned read on close and ignores a late response", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    (_url: RequestInfo | URL, _options?: RequestInit) =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(<SourceMcpPreview call={call} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const signal = fetcher.mock.calls[0]![1]!.signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response()));
  expect(screen.queryByText(/lookup input/)).toBeNull();
});
it("bounds nested tool output before stringifying and handles cycles", () => {
  const value: Record<string, unknown> = {
    body: "x".repeat(1_000_000),
    rest: Array.from({ length: 1000 }, (_, i) => i),
  };
  value.self = value;
  const result = sourcePreview(value);
  expect(result.length).toBeLessThanOrEqual(2049);
  expect(result).toContain("…");
});

it("opens one native read when React replays the explicit preview effect", async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _options?: RequestInit) => response(),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <StrictMode>
      <SourceMcpPreview call={call} />
    </StrictMode>,
  );
  await screen.findByText(/lookup input/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
