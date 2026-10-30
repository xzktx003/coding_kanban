import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@session/hooks/runtime", () => ({
  authHeaders: () => ({ Authorization: "Bearer local-fixture" }),
  buildUrl: (path: string) => path,
  isDesktopTauri: () => false,
  isTauri: () => false,
}));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));

import {
  getJsonWithOptions,
  isExplicitRequestRejection,
  postJsonWithOptions,
} from "./shared";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP JSON response semantics", () => {
  it("preserves GET/POST decoding, credentials, cancellation and read priority", async () => {
    const get = new Response('{"text":"手机😀"}');
    const post = new Response('{"accepted":true}');
    const nativeGet = vi.spyOn(get, "json");
    const nativePost = vi.spyOn(post, "json");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(get)
      .mockResolvedValueOnce(post);
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(
      await getJsonWithOptions("/api/example", { signal: controller.signal }),
    ).toEqual({ text: "手机😀" });
    expect(
      await postJsonWithOptions(
        "/api/codex/thread/turns/list?view=chat",
        { threadId: "exact-thread" },
        {
          signal: controller.signal,
          readPriority: "background",
        },
      ),
    ).toEqual({ accepted: true });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      signal: controller.signal,
      headers: { Authorization: "Bearer local-fixture" },
    });
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: "POST",
      signal: controller.signal,
      headers: { "x-session-read-priority": "background" },
      body: '{"threadId":"exact-thread"}',
    });
    expect(nativeGet).not.toHaveBeenCalled();
    expect(nativePost).not.toHaveBeenCalled();
  });

  it("reads an unknown-delivery error only once and retains write certainty", async () => {
    const response = new Response(
      JSON.stringify({
        message: "核对原始回执",
        code: "DELIVERY_UNKNOWN",
        deliveryStage: "outcome-unknown",
      }),
      { status: 409 },
    );
    const clone = vi.spyOn(response, "clone");
    const native = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const error = await postJsonWithOptions(
      "/api/write",
      {},
      { suppressToast: true },
    ).catch((value) => value);
    expect(error).toMatchObject({
      message: "核对原始回执",
      status: 409,
      code: "DELIVERY_UNKNOWN",
      deliveryStage: "outcome-unknown",
    });
    expect(isExplicitRequestRejection(error)).toBe(false);
    expect(clone).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(true);
  });

  it.each([
    ['{"error":"明确拒绝"}', "明确拒绝"],
    ["upstream unavailable", "Request failed: 503"],
    ["null", "Request failed: 503"],
  ])("keeps the error fallback for %s", async (body, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 503 })),
    );
    await expect(
      getJsonWithOptions("/api/read", { suppressToast: true }),
    ).rejects.toMatchObject({ message, status: 503 });
  });

  it.each(["truncated", "failed-stream"])(
    "never infers rejection after a %s error receipt",
    async (kind) => {
      const response =
        kind === "truncated"
          ? new Response('{"deliveryStage":"outcome-unknown",', { status: 409 })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("receipt stream lost"));
                },
              }),
              { status: 409 },
            );
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const error = await postJsonWithOptions(
        "/api/write",
        {},
        { suppressToast: true },
      ).catch((value) => value);
      expect(error).toMatchObject({
        status: 409,
        deliveryStage: "outcome-unknown",
      });
      expect(isExplicitRequestRejection(error)).toBe(false);
    },
  );
});
