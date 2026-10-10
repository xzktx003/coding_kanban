import { expect, it } from "vitest";
import { projectNativeHookRuns, nativeHookRunsForTurn } from "./nativeHookRuns";
it("merges actual native hook identity per owner and round without inventing success", () => {
  const run = { id: "same", status: "running", entries: [], displayOrder: 1n };
  const event = (
    threadId: string,
    turnId: string | null,
    run: object,
    method = "hook/started",
  ) => ({ method, params: { threadId, turnId, run } }) as never;
  const state = projectNativeHookRuns([
    event("one", "turn", run),
    event("two", "turn", run),
    event(
      "one",
      "turn",
      {
        ...run,
        status: "blocked",
        entries: [{ kind: "stop", text: "Need scope" }],
      },
      "hook/completed",
    ),
    event("one", null, run),
  ]);
  expect(state.get(JSON.stringify(["one", "turn"]))?.[0].status).toBe(
    "blocked",
  );
  expect(state.get(JSON.stringify(["two", "turn"]))?.[0].status).toBe(
    "running",
  );
  expect(state.get(JSON.stringify(["one", "turn"]))?.length).toBe(1);
  expect(state.size).toBe(2);
});
it("shows hook action metadata only after its actual live turn settles and retains other completed turns", () => {
  const runs = [{ id: "hook", status: "blocked" }] as never;
  const map = new Map([
    [JSON.stringify(["one", "live"]), runs],
    [JSON.stringify(["one", "old"]), runs],
  ]);
  const runtime = { threadId: "one", turnId: "live", running: true };
  expect(
    nativeHookRunsForTurn(map, "one", "live", runtime, new Set()),
  ).toBeUndefined();
  expect(nativeHookRunsForTurn(map, "one", "old", runtime, new Set())).toBe(
    runs,
  );
  expect(
    nativeHookRunsForTurn(
      map,
      "one",
      "live",
      { ...runtime, running: false },
      new Set(),
    ),
  ).toBe(runs);
  expect(
    nativeHookRunsForTurn(
      map,
      "one",
      "old",
      { ...runtime, turnId: null },
      new Set(['["one","old"]']),
    ),
  ).toBe(runs);
  expect(
    nativeHookRunsForTurn(
      map,
      "one",
      "live",
      { ...runtime, turnId: null },
      new Set(),
    ),
  ).toBeUndefined();
});
