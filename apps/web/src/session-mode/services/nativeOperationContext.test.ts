import { afterEach, expect, it, vi } from "vitest";
import { readNativeOperationContext } from "./nativeOperationContext";
import { getJsonWithOptions } from "./apiAdapt/shared";

vi.mock("./apiAdapt/shared", () => ({ getJsonWithOptions: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
});

it("cancels an in-flight scope read when the owning view is cancelled", async () => {
  vi.mocked(getJsonWithOptions).mockImplementation(() => new Promise(() => {}));
  const owner = new AbortController();
  const pending = readNativeOperationContext(owner.signal);
  const outcome = pending.catch((error) => error);
  const transport = vi.mocked(getJsonWithOptions).mock.calls[0][1]?.signal;
  expect(transport?.aborted).toBe(false);
  owner.abort();
  expect(transport?.aborted).toBe(true);
  await expect(outcome).resolves.toMatchObject({ name: "AbortError" });
});
