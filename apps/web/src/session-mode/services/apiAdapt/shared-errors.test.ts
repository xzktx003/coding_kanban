// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { postJsonWithOptions } from "./shared";
afterEach(() => vi.unstubAllGlobals());
it("shows the actionable queue conflict from the gateway instead of a generic HTTP label", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
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
