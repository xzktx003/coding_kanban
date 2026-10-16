import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  lstat,
  writeFile,
  chmod,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { captureProcessIdentity } from "../refresh-prototype/resources.mjs";
import { nativeAuthorizationIdentity } from "../refresh-prototype/authorization-boundary.mjs";
async function fixture(t) {
  const module = await import("../refresh-prototype/native-authority.mjs"),
    root = await mkdtemp(join(tmpdir(), "ck-authority-"));
  const scope = {
      domain: randomUUID(),
      generation: randomUUID(),
      ...(await captureProcessIdentity(process.pid)),
    },
    binding = nativeAuthorizationIdentity(
      { account: null, requiresOpenaiAuth: false },
      scope,
    );
  const listener = await module.listenNativeAuthority({
    runtimeRoot: root,
    scope,
    binding,
  });
  const clients = [];
  t.after(async () => {
    await chmod(root, 0o700);
    for (const c of clients) await c.close();
    await listener.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    scope,
    binding,
    listener,
    module,
    async connect(options = {}) {
      const c = await module.connectNativeAuthority({
        runtimeRoot: root,
        scope,
        authority: listener.identity,
        ...options,
      });
      clients.push(c);
      return c;
    },
  };
}
test("the native generation has one immutable original authority across manager connection replacement", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  a.assertCurrent();
  assert.deepEqual(a.binding, f.binding);
  await a.close();
  const b = await f.connect();
  b.assertCurrent();
  assert.deepEqual(b.binding, f.binding);
  const record = JSON.parse(
    await readFile(join(f.root, "authority.json"), "utf8"),
  );
  assert.deepEqual(record.binding, f.binding);
  assert.deepEqual(record.nativeScope, f.scope);
  assert.equal(
    (await lstat(join(f.root, "authority.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    JSON.stringify(f.listener.snapshot()).includes(record.token),
    false,
  );
});
test("same-value account revocation is synchronous and survives a newly attached manager", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  assert.equal(f.listener.revoke("authorization-changed"), true);
  assert.throws(() => a.assertCurrent(), /authority/);
  await a.closed;
  await assert.rejects(f.connect());
  assert.deepEqual(
    JSON.parse(await readFile(join(f.root, "authority.json"), "utf8")).binding,
    f.binding,
  );
  await assert.rejects(
    f.module.listenNativeAuthority({
      runtimeRoot: f.root,
      scope: f.scope,
      binding: f.binding,
    }),
    /existing|revoked/,
  );
});
test("foreign native, observer or binding identity never repairs the original anchor", async (t) => {
  const f = await fixture(t),
    original = await readFile(join(f.root, "authority.json"), "utf8");
  for (const options of [
    { scope: { ...f.scope, generation: randomUUID() } },
    { authority: { ...f.listener.identity, generation: randomUUID() } },
    { authority: { ...f.listener.identity, pid: process.pid + 10000000 } },
  ])
    await assert.rejects(f.connect(options));
  const a = await f.connect();
  assert.throws(
    () => a.assertBinding({ ...f.binding, fingerprint: "0".repeat(64) }),
    /authority/,
  );
  assert.equal(
    await readFile(join(f.root, "authority.json"), "utf8"),
    original,
  );
});
test("a consumer-observed account boundary revokes every anchor connection even if its marker cannot persist", async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    b = await f.connect();
  await chmod(f.root, 0o500);
  assert.equal(a.revoke(), false);
  assert.throws(() => a.assertCurrent(), /authority/);
  let timer;
  try {
    await Promise.race([
      b.closed,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("other authority connection survived revocation")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await chmod(f.root, 0o700);
  }
  assert.equal(f.listener.snapshot().available, false);
  await assert.rejects(f.connect());
});
test("observer closure or marker persistence failure blocks new admission and preserves a replaced public endpoint", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  await unlink(join(f.root, "authority.sock"));
  await writeFile(join(f.root, "authority.sock"), "PRESERVE", { mode: 0o600 });
  await f.listener.close();
  await a.closed;
  await assert.rejects(f.connect());
  assert.equal(
    await readFile(join(f.root, "authority.sock"), "utf8"),
    "PRESERVE",
  );
  const g = await fixture(t),
    b = await g.connect();
  await chmod(g.root, 0o500);
  assert.equal(g.listener.revoke("authorization-changed"), false);
  await b.closed;
  await chmod(g.root, 0o700);
  await assert.rejects(g.connect());
});
