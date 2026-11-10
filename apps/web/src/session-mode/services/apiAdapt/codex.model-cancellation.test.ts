import { afterEach, expect, it, vi } from "vitest";
import {
  listConfigProviders,
  listModels,
  listOtherModels,
  listProviderPresets,
} from "./codex";

afterEach(() => vi.unstubAllGlobals());

it("cancels every model catalog HTTP read when its signal is aborted", async () => {
  const fetchMock = vi.fn(
    (_url: RequestInfo | URL, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) {
          reject(new Error("Missing cancellation signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const reads = Promise.allSettled([
    listModels(options),
    listConfigProviders(options),
    listOtherModels(options),
    listProviderPresets(options),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  const reason = new Error("cancelled");
  controller.abort(reason);
  for (const result of await reads) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe(reason);
  }
});
