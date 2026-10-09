import { beforeEach, expect, test, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { applyAcpSessionSetting } from "./sessionSettings";
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));
beforeEach(() => {
  useAcpStore.getState().reset();
  useAcpStore.setState({
    connectionId: "connection",
    sessionId: "original",
    active: true,
  });
});

test("a late setting rejection cannot roll back a different session", async () => {
  let reject!: (error: Error) => void;
  const revert = vi.fn(),
    request = vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
  const result = applyAcpSessionSetting("model", vi.fn(), revert, request);
  expect(request).toHaveBeenCalledExactlyOnceWith("connection", "original");
  useAcpStore.setState({ sessionId: "other" });
  reject(new Error("old failure"));
  expect(await result).toBe(false);
  expect(revert).not.toHaveBeenCalled();
});

test("an older failure cannot undo a newer setting on the same session", async () => {
  let reject!: (error: Error) => void;
  const revert = vi.fn();
  const old = applyAcpSessionSetting(
    "model",
    vi.fn(),
    revert,
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const latestRequest = vi.fn(async () => {});
  const latest = applyAcpSessionSetting(
    "model",
    vi.fn(),
    vi.fn(),
    latestRequest,
  );
  expect(latestRequest).not.toHaveBeenCalled();
  reject(new Error("older rejection"));
  expect(await old).toBe(false);
  expect(await latest).toBe(true);
  expect(revert).not.toHaveBeenCalled();
});

test("an unapplied native setting prevents a prompt from claiming the optimistic model", async () => {
  let resolve!: () => void;
  const result = applyAcpSessionSetting(
    "model",
    vi.fn(),
    vi.fn(),
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  expect(
    Object.keys(useAcpStore.getState().pendingSettingChanges),
  ).toHaveLength(1);
  resolve();
  await result;
  expect(
    Object.keys(useAcpStore.getState().pendingSettingChanges),
  ).toHaveLength(0);
});

test("session context transitions block native settings and optimistic updates", async () => {
  useAcpStore.setState({
    sessionTransition: { version: 123, label: "恢复中" },
  });
  const update = vi.fn(),
    request = vi.fn();
  expect(await applyAcpSessionSetting("mode", update, vi.fn(), request)).toBe(
    false,
  );
  expect(update).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test("a current rejection rolls back its own setting and allows retry", async () => {
  const update = vi.fn(),
    revert = vi.fn();
  expect(
    await applyAcpSessionSetting("mode", update, revert, async () => {
      throw new Error("rejected");
    }),
  ).toBe(false);
  expect(update).toHaveBeenCalledOnce();
  expect(revert).toHaveBeenCalledOnce();
  expect(
    await applyAcpSessionSetting("mode", update, revert, async () => {}),
  ).toBe(true);
});

test("two rejected rapid choices restore the last confirmed setting rather than a rejected optimistic value", async () => {
  let model = "confirmed";
  let reject!: (error: Error) => void;
  const first = applyAcpSessionSetting(
    "model",
    () => {
      model = "first";
    },
    () => {
      model = "confirmed";
    },
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const second = applyAcpSessionSetting(
    "model",
    () => {
      model = "second";
    },
    () => {
      model = "first";
    },
    async () => {
      throw new Error("second rejected");
    },
  );
  reject(new Error("first rejected"));
  await Promise.all([first, second]);
  expect(model).toBe("confirmed");
});

test("hiding ACP keeps rollback owned by the same retained connection and session", async () => {
  let reject!: (error: Error) => void;
  const revert = vi.fn();
  const result = applyAcpSessionSetting(
    "model",
    vi.fn(),
    revert,
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  useAcpStore.setState({ active: false });
  reject(new Error("native rejected while hidden"));
  expect(await result).toBe(false);
  expect(revert).toHaveBeenCalledOnce();
});
