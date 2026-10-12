import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as nativeSurface from "./native-surface";
import CodexWorkbench from "./CodexWorkbench";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("shows unavailable native host honestly and navigation still works", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ available: false, reason: "独立宿主未配置" }),
    })),
  );
  const change = vi.fn();
  render(<CodexWorkbench active onModeChange={change} />);
  await screen.findByText("独立宿主未配置");
  expect(document.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^会话$/ }));
  expect(change).toHaveBeenCalledWith("session");
});
it("retains the original host frame and does not poll or navigate while another mode is active", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      available: true,
      iframeUrl: "/native-codex/?folder=%2Ftmp%2Fowned",
      fixtures: [
        { id: "019aabcd-1234-7890-abcd-0123456789ab", label: "原生会话 1" },
      ],
    }),
  }));
  vi.stubGlobal("fetch", fetcher);
  const change = vi.fn();
  const view = render(<CodexWorkbench active onModeChange={change} />);
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  const frame = document.querySelector("iframe");
  view.rerender(<CodexWorkbench active={false} onModeChange={change} />);
  view.rerender(<CodexWorkbench active onModeChange={change} />);
  expect(document.querySelector("iframe")).toBe(frame);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not mount a frame for a foreign URL even when metadata claims available", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        available: true,
        iframeUrl: "https://evil.test/native-codex/",
      }),
    })),
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  await screen.findByRole("alert");
  expect(document.querySelector("iframe")).toBeNull();
});

it("clears a load timeout when native windows become ready later", async () => {
  let ready: (count: number) => void = () => {};
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation(
    (_document, onCount, onReady) => {
      ready = (count) => { onCount(count); onReady?.(count); };
      return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn() };
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ available: true, iframeUrl: "/native-codex/" }),
    })),
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const frame = await screen.findByTitle("原生 Codex 会话窗口");
  fireEvent.load(frame);
  vi.useFakeTimers(); // Re-arm timeout using current fake clock.
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.load(screen.getByTitle("原生 Codex 会话窗口"));
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole("alert")).toBeTruthy();
  act(() => ready(2));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("2 个窗口")).toBeTruthy();
});
it("pauses its loading timeout while the Codex mode is hidden", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ available: true, iframeUrl: "/native-codex/" }),
    })),
  );
  const view = render(<CodexWorkbench active onModeChange={vi.fn()} />);
  await screen.findByTitle("原生 Codex 会话窗口");
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await act(async () => {
    await Promise.resolve();
  });
  view.rerender(<CodexWorkbench active={false} onModeChange={vi.fn()} />);
  act(() => vi.advanceTimersByTime(120_000));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("rechecks the connection without replacing an open native iframe or its unsent input", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ available: true, iframeUrl: "/native-codex/?folder=%2Ftmp%2Fowned" }),
  }));
  vi.stubGlobal("fetch", fetcher);
  const dispose = vi.fn();
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount) => ({
    start: () => onCount(2), pause: vi.fn(), dispose,
  }));
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const original = await screen.findByTitle("原生 Codex 会话窗口") as HTMLIFrameElement;
  original.contentDocument!.open();
  original.contentDocument!.write("<!doctype html><html><body></body></html>");
  original.contentDocument!.close();
  const input = original.contentDocument!.createElement("textarea");
  input.value = "keep my unsent draft";
  original.contentDocument!.body.append(input);
  fireEvent.load(original);
  await screen.findByText("2 个窗口");
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.getByTitle("原生 Codex 会话窗口")).toBe(original);
  expect(original.isConnected).toBe(true);
  expect(original.contentDocument!.querySelector("textarea")?.value).toBe("keep my unsent draft");
  expect(dispose).not.toHaveBeenCalled();
});

it("retains an already open native document when a connection recheck fails", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, iframeUrl: "/native-codex/" }) })
    .mockResolvedValueOnce({ ok: false });
  vi.stubGlobal("fetch", fetcher);
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const original = await screen.findByTitle("原生 Codex 会话窗口");
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await screen.findByRole("alert");
  expect(screen.getByTitle("原生 Codex 会话窗口")).toBe(original);
});
