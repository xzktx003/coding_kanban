// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  postJsonWithOptions,
  getJsonWithOptions,
  SessionApiError,
} from "./shared";
afterEach(() => vi.unstubAllGlobals());
it("shows the actionable queue conflict from the gateway instead of a generic HTTP label", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 409,
          error: "Conflict",
          message: "队列已在其他页面更新，请查看最新状态后重试",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  await expect(
    postJsonWithOptions("/followups/change", {}, { suppressToast: true }),
  ).rejects.toThrow("队列已在其他页面更新");
});
it.each(["GET", "POST"])(
  "preserves structured non-admission certainty on %s failures",
  async (method) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: "not admitted",
              code: "FOLLOWUP_QUEUE_OWNED_ELSEWHERE",
              deliveryStage: "not-admitted",
            }),
            { status: 409 },
          ),
        ),
    );
    const request =
      method === "GET"
        ? getJsonWithOptions("/followups", { suppressToast: true })
        : postJsonWithOptions("/followups/submit", {}, { suppressToast: true });
    const error = await request.catch((e) => e);
    expect(error).toBeInstanceOf(SessionApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "FOLLOWUP_QUEUE_OWNED_ELSEWHERE",
      deliveryStage: "not-admitted",
    });
  },
);
