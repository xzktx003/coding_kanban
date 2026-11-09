import { isAbsolute, resolve } from "node:path";
import { normalizeProjectRoots } from "./fixed-project-mounts.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/;
const failure = () => Object.assign(new Error("Recovery identity unavailable"), {
  code: "CONTAINER_RECOVERY_IDENTITY_INVALID",
});
const names = ["init", "bridge", "node", "native"];
const processKeys = ["pid", "ppid", "uid", "ticks", "nspids", "cpus", "noNewPrivs", "seccomp", "capEff", "cgroup", "pidns", "mntns"];
function fields(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure();
  const desc = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(desc).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(desc[key] ?? {}, "value"))) throw failure();
  return Object.fromEntries(keys.map((key) => [key, desc[key].value]));
}
function values(value, maximum) {
  if (!Array.isArray(value)) throw failure();
  const desc = Object.getOwnPropertyDescriptors(value), length = desc.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum ||
      Reflect.ownKeys(desc).length !== length + 1 ||
      Array.from({ length }, (_, i) => String(i)).some((key) => !Object.hasOwn(desc[key] ?? {}, "value"))) throw failure();
  return Array.from({ length }, (_, i) => desc[i].value);
}
function processIdentity(value) {
  const p = fields(value, processKeys);
  p.nspids = values(p.nspids, 8);
  if (!Number.isSafeInteger(p.pid) || p.pid <= 1 || !Number.isSafeInteger(p.ppid) || p.ppid < 1 ||
      !Number.isSafeInteger(p.uid) || p.uid < 0 || typeof p.ticks !== "string" || !DECIMAL.test(p.ticks) ||
      p.nspids.length < 2 || p.nspids[0] !== p.pid ||
      p.nspids.some((n) => !Number.isSafeInteger(n) || n <= 0) ||
      typeof p.cpus !== "string" || !/^[0-9,-]{1,128}$/.test(p.cpus) ||
      !["0", "1"].includes(p.noNewPrivs) || !["0", "1", "2"].includes(p.seccomp) ||
      typeof p.capEff !== "string" || !/^[0-9a-f]{16}$/i.test(p.capEff) ||
      typeof p.cgroup !== "string" || p.cgroup.length > 4096 ||
      p.cgroup.split("\n").length > 16 ||
      p.cgroup.split("\n").some((line) => !/^[0-9]+:[^:\x00-\x20\x7f]*:\/[^\x00-\x1f\x7f]*$/.test(line)) ||
      typeof p.pidns !== "string" || !/^pid:\[[0-9]+\]$/.test(p.pidns) ||
      typeof p.mntns !== "string" || !/^mnt:\[[0-9]+\]$/.test(p.mntns)) throw failure();
  return Object.freeze({ ...p, nspids: Object.freeze(p.nspids) });
}
function projectIdentity(value) {
  const p = fields(value, ["path", "dev", "ino", "uid", "gid", "mode"]);
  if (typeof p.path !== "string" || !isAbsolute(p.path) || resolve(p.path) !== p.path ||
      [p.dev, p.ino, p.uid, p.gid, p.mode].some((x) => typeof x !== "string" || !DECIMAL.test(x) || BigInt(x) > 0xffffffffffffffffn) ||
      (BigInt(p.mode) & 0o170000n) !== 0o040000n || (BigInt(p.mode) & 0o002n) !== 0n) throw failure();
  return Object.freeze(p);
}

/** Create a bounded, credential-free startup witness for one native container. */
export function captureContainerRecoveryIdentity(value) {
  try {
    const a = fields(value, ["version", "containerId", "profileId", "generation", "bootId", "configSha256", "filesSha256", "account", "projects", "processes"]);
    if (a.version !== 1 || typeof a.containerId !== "string" || !SHA.test(a.containerId) ||
        [a.profileId,a.generation,a.bootId].some((x) => typeof x !== "string" || !UUID.test(x)) ||
        [a.configSha256,a.filesSha256].some((x) => typeof x !== "string" || !SHA.test(x))) throw failure();
    const account = fields(a.account, ["kind", "binding"]);
    if (!((account.kind === "anonymous" && account.binding === null) ||
          (account.kind === "chatgpt" && typeof account.binding === "string" && SHA.test(account.binding)))) throw failure();
    const projects = values(a.projects, 8).map(projectIdentity);
    normalizeProjectRoots(projects.map((p) => p.path));
    const raw = fields(a.processes, names);
    const processes = Object.fromEntries(names.map((name) => [name, processIdentity(raw[name])]));
    const { init, bridge, node, native } = processes;
    if (new Set(names.map((name) => processes[name].pid)).size !== 4 || init.nspids.at(-1) !== 1 ||
        bridge.ppid !== init.pid || node.ppid !== bridge.pid || native.ppid !== node.pid ||
        names.some((name) => processes[name].uid !== init.uid || processes[name].pidns !== init.pidns || processes[name].cgroup !== init.cgroup) ||
        ![`/docker-${a.containerId}.scope`, `/docker/${a.containerId}`].some((suffix) => init.cgroup.endsWith(suffix)) ||
        projects.some((p) => BigInt(p.uid) !== BigInt(init.uid))) throw failure();
    return Object.freeze({ ...a, account: Object.freeze(account), projects: Object.freeze(projects), processes: Object.freeze(processes) });
  } catch { throw failure(); }
}

/** Compare the original witness with fresh observations and synchronous OS guards. */
export function matchesContainerRecoveryIdentity(expected, observed, verifyProcess) {
  try {
    if (typeof verifyProcess !== "function") return false;
    const a = captureContainerRecoveryIdentity(expected), b = captureContainerRecoveryIdentity(observed);
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
    for (let pass = 0; pass < 2; pass++) for (const name of names) {
      const result = verifyProcess(a.processes[name]);
      if (result instanceof Promise) void result.catch(() => {});
      if (result !== true) return false;
    }
    return true;
  } catch { return false; }
}
