import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("./sessionWindowVerification", () => ({
  verifySessionWindowTarget: api.verify,
}));
import { openSessionWindow } from "./openSessionWindow";
import { SESSION_WINDOW_INTENTS } from "./sessionWindowRecords";
import { invalidateCodexOperationScope } from "./codexOperationScope";
const target = {
  kind: "codex" as const,
  id: "exact-thread",
  cwd: "/private/project",
};
beforeEach(() => {
  localStorage.clear();
  api.verify
    .mockReset()
    .mockResolvedValue({
      runtimeInstance: "same-runtime",
      codexNamespace: "same-account",
    });
});
afterEach(() => vi.restoreAllMocks());
test("the user's gesture opens a credential-free exact intent with noopener even when open returns null", async () => {
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  const id = openSessionWindow(target);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(opened.mock.calls[0].slice(1)).toEqual([
    "_blank",
    "noopener,noreferrer",
  ]);
  const url = new URL(String(opened.mock.calls[0][0]));
  expect([...url.searchParams.keys()]).toEqual(["mode", "sessionWindow"]);
  expect(url.searchParams.get("sessionWindow")).toBe(id);
  expect(url.username + url.password + url.hash).toBe("");
  await vi.waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem(SESSION_WINDOW_INTENTS + id)!).status,
    ).toBe("ready"),
  );
  expect(
    JSON.parse(localStorage.getItem(SESSION_WINDOW_INTENTS + id)!).target,
  ).toEqual(target);
});
test("a source revocation while proof is held never publishes a ready launch record", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  let finish!: (value: unknown) => void;
  api.verify.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const id = openSessionWindow(target);
  await vi.waitFor(() => expect(api.verify).toHaveBeenCalled());
  invalidateCodexOperationScope();
  finish({ runtimeInstance: "same-runtime", codexNamespace: "same-account" });
  await vi.waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem(SESSION_WINDOW_INTENTS + id)!).status,
    ).toBe("failed"),
  );
});
