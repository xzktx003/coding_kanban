import { afterEach, expect, it, vi } from "vitest";
import { postNoContent, SessionApiError } from "./shared";
afterEach(() => vi.unstubAllGlobals());
it.each([400, 503])(
  "preserves HTTP %i for RPC rejection versus uncertain delivery",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "isolated error" }), { status }),
        ),
    );
    const error = await postNoContent(
      "/api/codex/approval/user-input",
      {},
    ).catch((error) => error);
    expect(error).toBeInstanceOf(SessionApiError);
    expect(error.status).toBe(status);
  },
);
