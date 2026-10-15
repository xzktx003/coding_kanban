import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function fixture() {
  const { createRefreshResourceMonitor } =
    await import("../refresh-prototype/resources.mjs");
  const domain = randomUUID(),
    generation = randomUUID();
  const nodes = new Map();
  const node = (pid, ppid, rssBytes, children = []) => ({
    pid,
    ppid,
    uid: process.getuid(),
    startTicks: String(pid * 10),
    state: "S",
    rssBytes,
    children,
  });
  nodes.set(10, node(10, 1, 100, [11]));
  nodes.set(11, node(11, 10, 200));
  nodes.set(20, node(20, 1, 300, [21]));
  nodes.set(21, node(21, 20, 400));
  const service = {
    record: { domain, generation, pid: 10, startTicks: "100" },
    async readRss() {
      return nodes.get(10)?.rssBytes;
    },
  };
  const roots = [
    { id: randomUUID(), kind: "host", pid: 20, startTicks: "200" },
  ];
  const inspectProcess = async (pid) => {
    const value = nodes.get(pid);
    if (!value) throw Object.assign(Error("gone"), { code: "ENOENT" });
    return structuredClone(value);
  };
  return {
    nodes,
    node,
    service,
    roots,
    inspectProcess,
    monitor: (options = {}) =>
      createRefreshResourceMonitor({
        service,
        roots,
        inspectProcess,
        ...options,
      }),
  };
}

test("resource admission measures native, code-server and their children once, without retaining process arguments", async () => {
  const f = await fixture();
  // One declared host root also contains the native process. It is counted once.
  f.nodes.get(20).children.push(10);
  f.nodes.get(10).ppid = 20;
  const monitor = f.monitor();
  const value = await monitor.read();
  assert.equal(value.rssBytes, 1000);
  assert.equal(value.processCount, 4);
  assert.equal(value.domain, f.service.record.domain);
  assert.equal(value.generation, f.service.record.generation);
  assert.equal(value.accounting, "process-rss-sum");
  assert.deepEqual(
    value.roots.map((r) => r.kind),
    ["native", "host"],
  );
  assert.equal(value.complete, true);
  assert.equal(JSON.stringify(value).includes("cmdline"), false);
  assert.equal(monitor.snapshot().available, true);
});

test("reparented observed descendants stay in the budget until their exact process exits; PID reuse is not adopted", async () => {
  const f = await fixture(),
    monitor = f.monitor();
  await monitor.read();
  f.nodes.get(20).children = [];
  f.nodes.get(21).ppid = 1;
  assert.equal((await monitor.read()).rssBytes, 1000);
  f.nodes.set(21, { ...f.node(21, 1, 9999), startTicks: "9999" });
  assert.equal((await monitor.read()).rssBytes, 600);
  assert.equal((await monitor.read()).processCount, 3);
});

test("missing host, stale root generation, unmeasured child and changing ancestry revoke measured admission", async () => {
  for (const change of [
    (f) => f.nodes.delete(20),
    (f) => {
      f.nodes.get(20).startTicks = "201";
    },
    (f) => {
      f.nodes.get(20).children.push(99);
    },
    (f) => {
      f.nodes.get(21).ppid = 1;
    },
    (f) => {
      f.nodes.get(21).rssBytes = undefined;
    },
    (f) => {
      f.nodes.get(21).uid++;
    },
  ]) {
    const f = await fixture(),
      monitor = f.monitor();
    await monitor.read();
    change(f);
    await assert.rejects(monitor.read(), /resource|process|identity|ancestry/i);
    assert.equal(monitor.snapshot().available, false);
    assert.equal(monitor.snapshot().rssBytes, null);
  }
});

test("resource scans reject changing trees and bounded process budgets instead of truncating RSS", async () => {
  const f = await fixture();
  await assert.rejects(f.monitor({ processLimit: 3 }).read(), /budget/);
  let reads = 0;
  const changing = f.monitor({
    inspectProcess: async (pid) => {
      const value = await f.inspectProcess(pid);
      if (pid === 20 && ++reads > 1) value.children = [];
      return value;
    },
  });
  await assert.rejects(changing.read(), /changed|ancestry/);
  assert.equal(changing.snapshot().available, false);
});

test("impossible ancestry cycles cannot be accepted as a complete owned resource measurement", async () => {
  const f = await fixture();
  f.nodes.get(20).ppid = 21;
  f.nodes.get(21).children = [20];
  await assert.rejects(f.monitor().read(), /ancestry/);
});

test("changed service identity also revokes the last successful resource snapshot", async () => {
  const f = await fixture(),
    monitor = f.monitor();
  await monitor.read();
  f.service.record.generation = randomUUID();
  await assert.rejects(monitor.read(), /identity changed/);
  assert.equal(monitor.snapshot().available, false);
  assert.equal(monitor.snapshot().rssBytes, null);
});

test("resource scanner has no background polling and fences concurrent reads and invalidated generations", async () => {
  const f = await fixture();
  let calls = 0,
    release;
  const held = new Promise((done) => {
    release = done;
  });
  const monitor = f.monitor({
    inspectProcess: async (pid) => {
      calls++;
      await held;
      return f.inspectProcess(pid);
    },
  });
  const pending = monitor.read();
  await Promise.resolve();
  await assert.rejects(monitor.read(), /in progress/);
  monitor.invalidate();
  release();
  await assert.rejects(pending, /invalidated/);
  const before = calls;
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(calls, before);
  await assert.rejects(monitor.read(), /invalidated/);
});

test(
  "Linux accounting includes a child forked by a non-main worker thread and preserves the owned processes",
  { timeout: 10000 },
  async (t) => {
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const { readFile } = await import("node:fs/promises");
    const {
      createRefreshResourceMonitor,
      captureProcessIdentity,
      inspectLinuxProcess,
    } = await import("../refresh-prototype/resources.mjs");
    // The child is intentionally forked from a worker thread: inspecting only
    // /proc/PID/task/PID/children misses this actual descendant on Linux.
    const workerSource = `
    const {parentPort}=require('node:worker_threads');
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e',
      'global.keep=Buffer.alloc(8*1024*1024,17);process.stdout.write("ready\\\\n");setInterval(()=>{},1000)'],
      {stdio:['ignore','pipe','ignore']});
    child.stdout.once('data',()=>parentPort.postMessage(child.pid));
    parentPort.on('message',()=>{child.kill('SIGTERM');child.once('exit',()=>process.exit(0));});
  `;
    const owner = spawn(
      process.execPath,
      [
        "-e",
        `
    const {Worker}=require('node:worker_threads');
    const worker=new Worker(${JSON.stringify(workerSource)},{eval:true});
    worker.once('message',pid=>process.stdout.write(JSON.stringify({pid})+'\\n'));
    process.on('SIGTERM',()=>worker.postMessage('stop'));
  `,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exit = once(owner, "exit");
    t.after(async () => {
      if (owner.exitCode === null && owner.signalCode === null)
        owner.kill("SIGTERM");
      await exit;
    });
    const [message] = await once(owner.stdout, "data");
    const grandchild = JSON.parse(message.toString()).pid;
    const identity = await captureProcessIdentity(owner.pid);
    const domain = randomUUID(),
      generation = randomUUID();
    const service = {
      record: { domain, generation, ...identity },
      async readRss() {
        const current = await inspectLinuxProcess(identity.pid);
        assert.equal(current.startTicks, identity.startTicks);
        return current.rssBytes;
      },
    };
    const mainChildren = await readFile(
      `/proc/${owner.pid}/task/${owner.pid}/children`,
      "utf8",
    );
    assert.equal(
      mainChildren.trim().split(/\s+/).includes(String(grandchild)),
      false,
    );
    const monitor = createRefreshResourceMonitor({ service });
    const measured = await monitor.read();
    assert.equal(measured.processCount, 2);
    assert.ok(measured.taskCount > 2);
    assert.ok(measured.rssBytes > (await service.readRss()));
    monitor.invalidate();
    assert.equal(
      (await inspectLinuxProcess(owner.pid)).startTicks,
      identity.startTicks,
    );
    assert.equal((await inspectLinuxProcess(grandchild)).ppid, owner.pid);
    assert.equal(owner.exitCode, null);
  },
);
