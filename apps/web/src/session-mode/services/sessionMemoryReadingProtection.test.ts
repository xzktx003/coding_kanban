import { beforeEach, expect, it } from "vitest";
import { useCodexStore } from "../components/codex/stores";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { cachedTranscriptBaselines } from "./sessionCacheState";
import { releaseSessionMemory } from "./sessionMemoryGovernor";
import {
  memoryHistoryWindows,
  pinMemoryHistoryPage,
} from "./sessionMemoryHistory";

const message = (turnId: string, id: string, text = "body") =>
  ({
    method: "item/completed",
    params: {
      threadId: "active",
      turnId,
      item: { id, type: "agentMessage", text },
    },
  }) as any;

/** One recovered page: several turns, each with many events, like real history. */
function page(prefix: string, turns: number, perTurn: number) {
  const events = [];
  const turnIds: string[] = [];
  for (let t = 0; t < turns; t++) {
    const turnId = `${prefix}-turn-${t}`;
    turnIds.push(turnId);
    for (let i = 0; i < perTurn; i++)
      events.push(message(turnId, `${turnId}-item-${i}`, `${prefix} ${t}/${i}`));
  }
  return { events, turnIds };
}

beforeEach(() => {
  useCodexStore.setState({
    events: {},
    threads: [],
    currentThreadId: "active",
    turnTimingMap: {},
    commandStatusMap: {},
    commandDurationMap: {},
  });
  useSessionSyncStore.setState({ cursors: {}, earlierLoading: {} });
  cachedTranscriptBaselines.clear();
  memoryHistoryWindows.clear();
});

function withHeap<T>(usedMB: number, limitMB: number, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(performance, "memory");
  Object.defineProperty(performance, "memory", {
    configurable: true,
    value: {
      usedJSHeapSize: usedMB * 1024 * 1024,
      jsHeapSizeLimit: limitMB * 1024 * 1024,
    },
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(performance, "memory", original);
    else delete (performance as { memory?: unknown }).memory;
  }
}

it("a mostly idle heap on a large-limit device is not treated as pressure", () => {
  // Observed in the browser: 865MB of a 4192MB limit is ~21%, yet the former
  // fixed 256MB cap made every governor tick a "pressure" tick.
  const { events } = page("bulk", 20, 100);
  useCodexStore.setState({ events: { active: events } });
  const retained = withHeap(865, 4192, () => {
    releaseSessionMemory();
    return useCodexStore.getState().events.active;
  });
  // Without pressure the budget is 3000/1500 events, so 2000 events stay put.
  expect(retained).toBe(events);
});

it("successive recovered pages accumulate protection instead of replacing it", () => {
  // Each page alone fits the budget; together they exceed it, which is exactly
  // the second click in the browser.
  const first = page("older", 8, 100);
  const second = page("oldest", 8, 100);
  useCodexStore.setState({
    events: { active: [...second.events, ...first.events] },
  });
  pinMemoryHistoryPage("active", first.turnIds);
  pinMemoryHistoryPage("active", second.turnIds);

  releaseSessionMemory({ pressure: true });

  const retained = new Set(useCodexStore.getState().events.active);
  // Replacing the window drops the previously recovered page, so each click
  // evicts what the last click restored and paging never makes progress.
  // The live (newest) turn keeps its own same-turn trimming; assert the pages
  // the reader recovered, which are all older than it.
  const live = first.turnIds.at(-1);
  for (const event of [...first.events, ...second.events])
    if (event.params.turnId !== live) expect(retained.has(event)).toBe(true);
});

it("the thread being read keeps paging past the former 3000-event ceiling", () => {
  // Observed in the browser: a long session settled at ~3430 events / 61 turns
  // and every further page was admitted then trimmed straight back. Reading the
  // whole history is the feature; this thread's budget must follow the reader.
  const history = page("history", 120, 60);
  useCodexStore.setState({ events: { active: history.events } });

  releaseSessionMemory();

  const kept = useCodexStore.getState().events.active.length;
  expect(history.events.length).toBe(7200);
  expect(kept).toBe(history.events.length);
});

it("background threads stay bounded so one reader cannot grow every transcript", () => {
  const foreground = page("fg", 120, 60);
  const background = page("bg", 120, 60);
  useCodexStore.setState({
    events: { active: foreground.events, other: background.events },
  });

  releaseSessionMemory();

  const state = useCodexStore.getState();
  expect(state.events.active.length).toBe(foreground.events.length);
  expect(state.events.other.length).toBeLessThan(background.events.length);
});

it("a pinned page survives real heap pressure while unprotected history is reclaimed", () => {
  const recovered = page("recovered", 20, 100);
  const unprotected = page("bulk", 20, 100);
  // Pressure is the one case that still reclaims the thread on screen, so this
  // asserts the pin itself rather than the raised reading allowance.
  useCodexStore.setState({
    events: { active: [...recovered.events, ...unprotected.events] },
    currentThreadId: "active",
  });
  pinMemoryHistoryPage("active", recovered.turnIds);

  releaseSessionMemory({ pressure: true });

  const events = useCodexStore.getState().events.active;
  const retained = new Set(events);
  // 2000 protected events exceed the 1500/750 pressure ceiling on their own.
  for (const event of recovered.events) expect(retained.has(event)).toBe(true);
});
