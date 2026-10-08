import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { applySessionTabAction } from "@agent-orchestrator/shared";
const a = { kind: "codex" as const, id: "a" },
  b = { kind: "codex" as const, id: "closed-target" },
  c = { kind: "codex" as const, id: "c" };
const stops: Array<() => void> = [];
let cards = [a, b];
let clients: Record<string, number> = {};
let revision = 1;
let offline = false;
const fetcher = vi.fn(async (_url: any, init?: RequestInit) => {
  if (offline) throw new Error("offline");
  let sequence = 0;
  if (init?.method === "POST") {
    const body = JSON.parse(init.body as string);
    sequence = clients[body.clientId] ?? 0;
    for (const op of body.operations) {
      if (op.seq <= sequence) continue;
      if (op.seq !== sequence + 1) return new Response("{}", { status: 409 });
      cards = applySessionTabAction(cards, op.action) as typeof cards;
      sequence = op.seq;
      revision++;
    }
    clients[body.clientId] = sequence;
  }
  return new Response(
    JSON.stringify({ initialized: true, revision, cards, sequence }),
  );
});
async function page() {
  vi.resetModules();
  const { useAgentCenterStore: store } =
    await import("../stores/useAgentCenterStore");
  const { startSessionTabsSync: start } = await import("./sessionTabsSync");
  return {
    store,
    start: () => {
      const stop = start(fetcher as typeof fetch, 1000);
      stops.push(stop);
      return stop;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.useFakeTimers();
  localStorage.clear();
  fetcher.mockClear();
  cards = [a, b];
  clients = {};
  revision = 1;
  offline = false;
  localStorage.setItem(
    "kanban.session.agent-center-store",
    JSON.stringify({
      version: 5,
      state: {
        cards: [a, b],
        currentAgentCardId: "a",
        currentAgentCardKind: "codex",
        syncClientId: "same-browser",
        nextTabSequence: 1,
        pendingTabOperations: [],
        sharedTabsInitialized: true,
      },
    }),
  );
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});
it("a close from a second page is not discarded as the first page operation with the same sequence", async () => {
  const first = await page(),
    second = await page();
  first.start();
  second.start();
  await vi.advanceTimersByTimeAsync(1);
  first.store.getState().addAgentCard(c);
  await vi.advanceTimersByTimeAsync(60);
  second.store.getState().removeCard(b);
  await vi.advanceTimersByTimeAsync(60);
  expect(cards.map((c) => c.id)).toEqual(["a", "c"]);
  await vi.advanceTimersByTimeAsync(1100);
  expect(first.store.getState().cards.map((c) => c.id)).toEqual(["a", "c"]);
  const reopened = await page();
  reopened.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(reopened.store.getState().cards.map((c) => c.id)).toEqual(["a", "c"]);
});
it("a persisted offline close survives another page writing an older whole-store cache and a reload", async () => {
  const first = await page(),
    second = await page();
  const stop = first.start();
  await vi.advanceTimersByTimeAsync(1);
  offline = true;
  first.store.getState().removeCard(b);
  await vi.advanceTimersByTimeAsync(60);
  stop();
  second.store.getState().setCardsViewMode("grid");
  const reopened = await page();
  offline = false;
  reopened.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(cards.map((c) => c.id)).toEqual(["a"]);
  expect(reopened.store.getState().pendingTabOperations).toHaveLength(0);
});
it("a previously ignored legacy close is repaired instead of discarded on its old sequence acknowledgement", async () => {
  clients["same-browser"] = 9;
  const first = await page();
  first.store.setState({
    pendingTabOperations: [
      { seq: 1, action: { type: "remove", key: "codex:closed-target" } },
    ],
    cards: [a],
  });
  first.start();
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() =>
    expect(
      first.store.getState().pendingTabOperations.every((op) => !!op.id),
    ).toBe(true),
  );
  await vi.advanceTimersByTimeAsync(120);
  expect(cards.map((c) => c.id)).toEqual(["a"]);
});
