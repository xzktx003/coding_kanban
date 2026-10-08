import { afterEach, expect, it, vi } from "vitest";
const notify = vi.hoisted(() => vi.fn());
vi.mock("@session/components/ui/use-toast", () => ({ toast: notify }));
import { threadRollback } from "./codex";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("leaves rollback errors to the confirmation dialog without a duplicate raw protocol toast", async () => {
  const error =
    'Request failed: {"code":-32600,"message":"unknown variant `thread/rollback`"}';
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error }), { status: 500 }),
      ),
  );
  await expect(
    threadRollback({ threadId: "fixture", numTurns: 2, beforeTurnId: "cut" }),
  ).rejects.toThrow(error);
  expect(notify).not.toHaveBeenCalled();
});
