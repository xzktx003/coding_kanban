import { afterEach, expect, it } from "vitest";
import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { usePairingStore } from "../stores/usePairingStore";
import { invalidateCodexOperationScope } from "./codexOperationScope";
import {
  captureNativeExecutionScope,
  currentNativeExecutionTiming,
  recordNativeExecutionTiming,
  reconcileNativeExecutionEvents,
} from "./nativeTurnExecutionProof";
import type { ServerNotification } from "../bindings";
import {
  markCachedTurnExecutionUnverified,
  isCachedTurnExecutionUnverified,
} from "./cachedTurnExecutionView";
const timing = () => ({
  turnId: "native-turn",
  status: "inProgress" as const,
  startedAtMs: 1000,
  durationMs: null,
});
afterEach(() => {
  usePairingStore.setState({ desktops: [], selectedHost: null });
  useCodexStore.setState({
    accountNamespace: null,
    account: null,
    hasAccount: null,
  });
});

it("does not treat cache, optimistic timings, copied objects or another thread as native proof", () => {
  const native = timing();
  expect(currentNativeExecutionTiming("owner", native)).toBeUndefined();
  recordNativeExecutionTiming("owner", native, captureNativeExecutionScope());
  expect(currentNativeExecutionTiming("owner", native)).toBe(native);
  expect(currentNativeExecutionTiming("owner", { ...native })).toBeUndefined();
  expect(currentNativeExecutionTiming("other", native)).toBeUndefined();
});

it("revokes exact same-valued account/runtime generations without changing bodies or tasks", () => {
  const native = timing();
  recordNativeExecutionTiming("owner", native, captureNativeExecutionScope());
  invalidateCodexOperationScope();
  expect(currentNativeExecutionTiming("owner", native)).toBeUndefined();
  expect(native.status).toBe("inProgress");
});

it("rejects old account identity even before a scope subscription runs", () => {
  useCodexStore.setState({ hasAccount: true, accountNamespace: "account-a" });
  const native = timing();
  recordNativeExecutionTiming("owner", native, captureNativeExecutionScope());
  useCodexStore.setState({ accountNamespace: "account-b" });
  expect(currentNativeExecutionTiming("owner", native)).toBeUndefined();
});

it.each(["token", "endpoint"])(
  "rejects an old native %s source and delayed proof registration",
  (source) => {
    const device = {
      name: "fixture",
      host: "fixture.invalid",
      port: 45000,
      token: "old-fixture-token",
    };
    usePairingStore.setState({ desktops: [device], selectedHost: device.host });
    const scope = captureNativeExecutionScope();
    const native = timing();
    recordNativeExecutionTiming("owner", native, scope);
    usePairingStore.setState({
      desktops: [
        {
          ...device,
          ...(source === "token"
            ? { token: "new-fixture-token" }
            : { port: 45001 }),
        },
      ],
    });
    expect(currentNativeExecutionTiming("owner", native)).toBeUndefined();
    const late = timing();
    recordNativeExecutionTiming("owner", late, scope);
    expect(currentNativeExecutionTiming("owner", late)).toBeUndefined();
  },
);

it.each(["inProgress", "completed", "failed", "interrupted"] as const)(
  "immediately reconciles only the proven exact cached turn as %s",
  (status) => {
    const terminal = (id: string) =>
      ({
        method: "turn/completed",
        params: {
          threadId: "owner",
          turn: {
            id,
            status: "interrupted",
            startedAt: 1,
            completedAt: 2,
            durationMs: 10,
            items: [],
            itemsView: "full",
            error: null,
          },
        },
      }) as ServerNotification;
    const older = terminal("older-real-interruption"),
      latest = terminal("native-turn");
    markCachedTurnExecutionUnverified(latest);
    const events = [older, latest];
    const native = { ...timing(), status };
    recordNativeExecutionTiming("owner", native, captureNativeExecutionScope());
    const projected = reconcileNativeExecutionEvents(
      "owner",
      events,
      native,
      status === "inProgress",
    );
    expect(projected[0]).toBe(older);
    expect(events).toEqual([older, latest]);
    expect(isCachedTurnExecutionUnverified(latest)).toBe(true);
    if (status === "inProgress") expect(projected).toEqual([older]);
    else {
      expect(projected[1]).not.toBe(latest);
      expect(isCachedTurnExecutionUnverified(projected[1])).toBe(false);
      expect(projected[1]).toMatchObject({
        params: { turn: { id: "native-turn", status } },
      });
    }
  },
);
