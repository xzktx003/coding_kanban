import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  captureContainerRecoveryIdentity,
  matchesContainerRecoveryIdentity,
} from "../src/container-recovery-identity.mjs";

function fixture() {
  const containerId = "a".repeat(64), pidns = "pid:[1234]", mntns = "mnt:[2345]";
  const process = (pid, ppid, nsid) => ({
    pid, ppid, uid: 1000, ticks: String(pid * 3), nspids: [pid, nsid],
    cpus: "4", noNewPrivs: "1", seccomp: "2", capEff: "0000000000000000",
    cgroup: `0::/system.slice/docker-${containerId}.scope`, pidns, mntns,
  });
  return {
    version: 1, containerId, profileId: randomUUID(), generation: randomUUID(),
    bootId: randomUUID(), configSha256: "b".repeat(64), filesSha256: "c".repeat(64),
    account: { kind: "chatgpt", binding: "d".repeat(64) },
    projects: [{ path: "/workspace/repo", dev: "1", ino: "2", uid: "1000", gid: "1000", mode: "16893" }],
    processes: {
      init: process(101, 1, 1), bridge: process(102, 101, 2),
      node: process(103, 102, 3), native: process(104, 103, 4),
    },
  };
}

test("recovery identity binds every original process, account, project and file witness", () => {
  const value = fixture(), anchor = captureContainerRecoveryIdentity(value);
  assert.ok(Object.isFrozen(anchor) && Object.isFrozen(anchor.processes.native));
  assert.equal(matchesContainerRecoveryIdentity(anchor, value, () => true), true);
  for (const mutate of [
    (x) => { x.processes.init.ticks = "999"; },
    (x) => { x.processes.bridge.pidns = "pid:[999]"; },
    (x) => { x.processes.native.mntns = "mnt:[999]"; },
    (x) => { x.account.binding = "e".repeat(64); },
    (x) => { x.projects[0].ino = "3"; },
    (x) => { x.filesSha256 = "f".repeat(64); },
    (x) => { x.configSha256 = "f".repeat(64); },
  ]) {
    const changed = structuredClone(value); mutate(changed);
    assert.equal(matchesContainerRecoveryIdentity(anchor, changed, () => true), false);
  }
  assert.equal(matchesContainerRecoveryIdentity(anchor, value, () => false), false);
  assert.equal(matchesContainerRecoveryIdentity(anchor, value, async () => true), false);
});

test("recovery identity rejects malformed, ambiguous or accessor-backed input", () => {
  for (const mutate of [
    (x) => { x.processes.init.nspids = [101, 2]; },
    (x) => { x.processes.node.ppid = 101; },
    (x) => { x.processes.native.cgroup = "/unrelated"; },
    (x) => { x.account = { kind: "chatgpt", binding: null }; },
    (x) => { x.projects.push({ ...x.projects[0] }); },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => captureContainerRecoveryIdentity(value), { code: "CONTAINER_RECOVERY_IDENTITY_INVALID" });
  }
  const value = fixture(); let invoked = false;
  Object.defineProperty(value.account, "binding", { get() { invoked = true; return "d".repeat(64); } });
  assert.throws(() => captureContainerRecoveryIdentity(value), { code: "CONTAINER_RECOVERY_IDENTITY_INVALID" });
  assert.equal(invoked, false);
});
