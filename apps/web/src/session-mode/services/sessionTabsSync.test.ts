import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startSessionTabsSync } from "./sessionTabsSync";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
const a = { kind: "codex" as const, id: "a" };
const b = { kind: "cc" as const, id: "b" };
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useAgentCenterStore.setState({
    cards: [a],
    pendingTabOperations: [],
    nextTabSequence: 1,
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
    detachedCard: null,
    sharedTabsInitialized: false,
    tabSyncError: null,
  });
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});
it("polling changes only shared cards while local selection/layout changes cause no writes", async () => {
  const fetcher = vi.fn(
    async (_url: unknown, init: RequestInit | undefined) =>
      new Response(
        JSON.stringify({
          initialized: true,
          revision: 1,
          cards: init?.method === "POST" ? [a] : [b, a],
          sequence: 0,
        }),
      ),
  );
  stop = startSessionTabsSync(fetcher as typeof fetch, 1000);
  await vi.advanceTimersByTimeAsync(1);
  useAgentCenterStore.getState().setCardsViewMode("grid");
  useAgentCenterStore.getState().setCurrentAgentCardId("a", "codex");
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher.mock.calls.map((c) => c[1]?.method)).toEqual(["POST", "GET"]);
  expect(useAgentCenterStore.getState().cards).toEqual([b, a]);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
  expect(useAgentCenterStore.getState().cardsViewMode).toBe("grid");
});
it("failed uploads retain operations and retry the same sequence without erasing changes made in flight", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          initialized: true,
          revision: 2,
          cards: [b],
          sequence: 1,
        }),
      ),
    );
  useAgentCenterStore.getState().addAgentCard(b);
  stop = startSessionTabsSync(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(1);
  expect(useAgentCenterStore.getState().pendingTabOperations).toHaveLength(1);
  expect(useAgentCenterStore.getState().tabSyncError).toBeTruthy();
  await vi.advanceTimersByTimeAsync(5000);
  useAgentCenterStore.getState().removeCard(a);
  resolve(
    new Response(
      JSON.stringify({
        initialized: true,
        revision: 1,
        cards: [a, b],
        sequence: 1,
      }),
    ),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(useAgentCenterStore.getState().cards).toEqual([b]);
  expect(
    useAgentCenterStore.getState().pendingTabOperations.map((o) => o.seq),
  ).toEqual([2]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).operations[0].seq).toBe(1);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).operations[0].seq).toBe(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).clientId).toBe(
    JSON.parse(fetcher.mock.calls[1][1].body).clientId,
  );
  await vi.advanceTimersByTimeAsync(60);
  expect(useAgentCenterStore.getState().pendingTabOperations).toEqual([]);
});

it("an explicit connection retry immediately retries failed sync without waiting for backoff", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  stop = startSessionTabsSync(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(1);
  expect(useAgentCenterStore.getState().tabSyncError).toBeTruthy();
  const attempts = fetcher.mock.calls.length;
  window.dispatchEvent(new Event("session-connection-retry"));
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher.mock.calls.length).toBe(attempts + 1);
});

it("a retry requested during an in-flight failure runs next without duplicate concurrent requests", async () => {
  let reject!: (error: Error) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((_, fail) => {
          reject = fail;
        }),
    )
    .mockRejectedValue(new Error("offline"));
  stop = startSessionTabsSync(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(1);
  window.dispatchEvent(new Event("session-connection-retry"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  reject(new Error("offline"));
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
