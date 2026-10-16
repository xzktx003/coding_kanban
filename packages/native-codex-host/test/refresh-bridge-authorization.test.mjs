import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { nativeAuthorizationIdentity } from "../refresh-prototype/authorization-boundary.mjs";

function fixture() {
  const scope = {
      domain: randomUUID(),
      generation: randomUUID(),
      pid: process.pid,
      startTicks: "123",
    },
    requests = [];
  let nativeClosed,
    controlClosed,
    observer,
    closes = 0,
    reads = 0,
    hook = async () => {},
    authorityHook = () => {},
    controlHook = async (value) => value;
  const nativeDone = new Promise((r) => (nativeClosed = r)),
    controlDone = new Promise((r) => (controlClosed = r));
  let account = { account: null, requiresOpenaiAuth: false };
  const service = {
    record: scope,
    async confirmAuthorization() {},
    async connect(options) {
      observer = options.onLifecycle;
      await hook();
      return {
        closed: nativeDone,
        assertAuthorizationCurrent() {
          authorityHook();
        },
        async request(method, params) {
          requests.push({ method, params });
          reads++;
          return account;
        },
        async close() {
          closes++;
          nativeClosed();
        },
      };
    },
  };
  const control = {
    serviceScope: scope,
    closed: controlDone,
    async authorization() {
      return controlHook(nativeAuthorizationIdentity(account, scope));
    },
  };
  return {
    scope,
    service,
    control,
    requests,
    get closes() {
      return closes;
    },
    get reads() {
      return reads;
    },
    setHook(value) {
      hook = value;
    },
    setAuthorityHook(value) {
      authorityHook = value;
    },
    setAccount(value) {
      account = value;
    },
    setControlHook(value) {
      controlHook = value;
    },
    emit(method) {
      observer({ method });
    },
    controlClosed: () => controlClosed(),
    nativeClosed: () => nativeClosed(),
  };
}
const wait = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("authorization observation missing");
};
test("the official write guard synchronously checks the immutable anchor before its observer close event arrives", async (t) => {
  const { createBridgeAuthorization } =
      await import("../refresh-prototype/bridge-authorization.mjs"),
    f = fixture();
  const guard = await createBridgeAuthorization({
    service: f.service,
    control: f.control,
  });
  t.after(() => guard.close());
  f.setAuthorityHook(() => {
    throw Error("authority marker already persisted");
  });
  assert.throws(() => guard.assertCurrent(), /authorization|authority/);
  assert.equal(guard.signal.aborted, true);
  assert.equal(f.reads, 2);
});
test("a fresh bridge also requires the original native generation authority", async () => {
  const { createBridgeAuthorization } =
      await import("../refresh-prototype/bridge-authorization.mjs"),
    f = fixture();
  f.service.confirmAuthorization = async () => {
    throw Error("original authority revoked");
  };
  await assert.rejects(
    createBridgeAuthorization({ service: f.service, control: f.control }),
    /authority/,
  );
  assert.equal(f.closes, 1);
});
test("bridge independently initializes and binds actual read-only account identity to the persistent manager without thread operations", async (t) => {
  const { createBridgeAuthorization } =
      await import("../refresh-prototype/bridge-authorization.mjs"),
    f = fixture();
  const guard = await createBridgeAuthorization({
    service: f.service,
    control: f.control,
  });
  t.after(() => guard.close());
  guard.assertCurrent();
  assert.equal(guard.signal.aborted, false);
  assert.deepEqual(f.requests, [
    { method: "account/read", params: { refreshToken: false } },
    { method: "account/read", params: { refreshToken: false } },
  ]);
  f.emit("account/rateLimits/updated");
  guard.assertCurrent();
  f.emit("account/updated");
  assert.equal(guard.signal.aborted, true);
  assert.throws(() => guard.assertCurrent(), /authorization/);
  await guard.close();
  await guard.close();
  assert.equal(f.closes, 1);
});
test("control exit or independent native connection loss revokes a live bridge without a replay or native shutdown", async () => {
  const { createBridgeAuthorization } =
    await import("../refresh-prototype/bridge-authorization.mjs");
  for (const boundary of ["controlClosed", "nativeClosed"]) {
    const f = fixture(),
      guard = await createBridgeAuthorization({
        service: f.service,
        control: f.control,
      });
    f[boundary]();
    await wait(() => guard.signal.aborted);
    assert.throws(() => guard.assertCurrent(), /authorization/);
    await guard.close();
    assert.equal(f.reads, 2);
    assert.equal(f.closes, 1);
  }
});
test("changed manager binding, foreign native scope and repeated initial account notice never yield a usable bridge", async () => {
  const { createBridgeAuthorization } =
    await import("../refresh-prototype/bridge-authorization.mjs");
  {
    const f = fixture();
    f.control.serviceScope = { ...f.scope, generation: randomUUID() };
    await assert.rejects(
      createBridgeAuthorization({ service: f.service, control: f.control }),
    );
    assert.equal(f.closes, 0);
    assert.equal(f.reads, 0);
  }
  {
    const f = fixture();
    let calls = 0;
    f.setControlHook((value) =>
      ++calls === 1 ? value : { ...value, fingerprint: "0".repeat(64) },
    );
    await assert.rejects(
      createBridgeAuthorization({ service: f.service, control: f.control }),
      /authorization/,
    );
    assert.equal(f.closes, 1);
  }
  {
    const f = fixture();
    f.setHook(async () => {
      f.emit("account/updated");
      f.emit("account/updated");
    });
    await assert.rejects(
      createBridgeAuthorization({ service: f.service, control: f.control }),
      /authorization/,
    );
    assert.equal(f.closes, 1);
    assert.equal(f.reads, 0);
  }
});
test("aborting during binding cannot later restore authorization or leave its own native observer open", async () => {
  const { createBridgeAuthorization } =
      await import("../refresh-prototype/bridge-authorization.mjs"),
    f = fixture(),
    abort = new AbortController();
  let release, entered;
  const held = new Promise((r) => (release = r)),
    started = new Promise((r) => (entered = r));
  f.setHook(async () => {
    entered();
    await held;
  });
  const pending = assert.rejects(
    createBridgeAuthorization({
      service: f.service,
      control: f.control,
      signal: abort.signal,
    }),
    /authorization/,
  );
  await started;
  abort.abort();
  release();
  await pending;
  assert.equal(f.closes, 1);
  assert.equal(f.reads, 0);
});
