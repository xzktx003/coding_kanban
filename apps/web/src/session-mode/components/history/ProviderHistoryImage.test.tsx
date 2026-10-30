import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const scope = vi.hoisted(() => ({
  revision: 0,
  invalidate: undefined as (() => void) | undefined,
}));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => true,
}));
vi.mock("./historySourceScope", () => ({
  captureHistorySourceScope: (path: string) => ({
    url: path,
    headers: {},
    revision: scope.revision,
  }),
  isHistorySourceScopeCurrent: (captured: { revision: number }) =>
    captured.revision === scope.revision,
  watchHistorySourceScope: (_: unknown, invalidate: () => void) => {
    scope.invalidate = invalidate;
    return () => {
      scope.invalidate = undefined;
    };
  },
}));
import { ProviderHistoryDetail } from "./ProviderHistoryDetail";
import { useProviderTranscriptStore } from "@session/services/sessionProviderTranscriptState";
const fetcher = vi.fn(),
  createUrl = vi.fn(),
  revokeUrl = vi.fn();
const image = (mimeType = "image/png", width = 1, height = 1) =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: {
      "content-type": mimeType,
      "x-history-image-width": String(width),
      "x-history-image-height": String(height),
      "x-history-image-revision": "a".repeat(64),
    },
  });
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  createUrl.mockReset();
  revokeUrl.mockReset();
  let id = 0;
  createUrl.mockImplementation(() => `blob:history-owned-${++id}`);
  scope.revision = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: createUrl,
      revokeObjectURL: revokeUrl,
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("fetches one exact image on demand and releases the old blob when moving or closing", async () => {
  fetcher
    .mockResolvedValueOnce(image())
    .mockResolvedValueOnce(image("image/jpeg"));
  render(
    <ProviderHistoryDetail
      provider="cc"
      sessionId="original-session"
      itemId="original-item"
      images={[
        { index: 0, mimeType: "image/png" },
        { index: 2, mimeType: "image/jpeg" },
      ]}
    />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
  await screen.findByRole("img", { name: "历史图片 1" });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    session_id: "original-session",
    item_id: "original-item",
    image_index: 0,
  });
  expect(
    screen.getByRole("link", { name: "下载原图" }).getAttribute("href"),
  ).toBe("blob:history-owned-1");
  expect(
    Object.values(useProviderTranscriptStore.getState().entries).find(
      (entry) => entry.kind === "auxiliary",
    )?.externalBodyBytes,
  ).toBe(8);
  fireEvent.click(screen.getByRole("button", { name: "下一张" }));
  await screen.findByRole("img", { name: "历史图片 2" });
  expect(revokeUrl).toHaveBeenCalledWith("blob:history-owned-1");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).image_index).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "关闭图片" }));
  expect(revokeUrl).toHaveBeenCalledWith("blob:history-owned-2");
  expect(screen.queryByRole("img")).toBeNull();
  expect(
    Object.values(useProviderTranscriptStore.getState().entries).filter(
      (entry) => entry.kind === "auxiliary",
    ),
  ).toEqual([]);
});

it("an oversized pixel preview remains downloadable without decoding or storing a second image", async () => {
  fetcher
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT",
          error: "pixel preview limit",
        }),
        { status: 413 },
      ),
    )
    .mockResolvedValueOnce(image("image/png", 10000, 10000));
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    render(
      <ProviderHistoryDetail
        provider="acp"
        sessionId="source-session"
        itemId="source-3"
        images={[{ index: 0, mimeType: "image/png" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("像素");
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      session_id: "source-session",
      item_id: "source-3",
      image_index: 0,
      download: true,
    });
    await waitFor(() =>
      expect(revokeUrl).toHaveBeenCalledWith("blob:history-owned-1"),
    );
    expect(screen.queryByRole("img")).toBeNull();
  } finally {
    click.mockRestore();
  }
});

it("a revoked source aborts the pending image and never publishes a late blob", async () => {
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  render(
    <ProviderHistoryDetail
      provider="cc"
      sessionId="source-session"
      itemId="source-item"
      images={[{ index: 0, mimeType: "image/png" }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  act(() => scope.invalidate?.());
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(image()));
  expect(createUrl).not.toHaveBeenCalled();
});

it("the download link checks its captured image scope even before a reset observer is delivered", async () => {
  fetcher.mockResolvedValueOnce(image());
  render(
    <ProviderHistoryDetail
      provider="cc"
      sessionId="original"
      itemId="source"
      images={[{ index: 0, mimeType: "image/png" }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
  await screen.findByRole("img");
  scope.revision++;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    screen.getByRole("link", { name: "下载原图" }).dispatchEvent(click);
  });
  expect(click.defaultPrevented).toBe(true);
  expect(screen.queryByRole("img")).toBeNull();
  expect(revokeUrl).toHaveBeenCalledWith("blob:history-owned-1");
});

it("rejects an oversized image response before creating or decoding a browser image", async () => {
  const response = image();
  response.headers.set("content-length", String(10 * 1024 * 1024 + 1));
  fetcher.mockResolvedValueOnce(response);
  render(
    <ProviderHistoryDetail
      provider="acp"
      sessionId="original"
      itemId="source"
      images={[{ index: 0, mimeType: "image/png" }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("大小限制");
  expect(createUrl).not.toHaveBeenCalled();
  expect(screen.queryByRole("img")).toBeNull();
});

it("rejects a failed-preview download after its original owner scope changed before observers run", async () => {
  fetcher
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT" }),
        { status: 413 },
      ),
    )
    .mockResolvedValueOnce(image());
  render(
    <ProviderHistoryDetail
      provider="cc"
      sessionId="original"
      itemId="source"
      images={[{ index: 0, mimeType: "image/png" }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
  await screen.findByRole("alert");
  scope.revision++;
  fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("region", { name: "历史原图" })).toBeNull();
});
