// Read-only Linux process accounting for an explicitly owned private service.
// No timers, process signals, command-line capture or system-wide process scan.
import { readFile, readdir, stat } from "node:fs/promises";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pidValid = (pid) => Number.isSafeInteger(pid) && pid > 1;
const ticksValid = (ticks) =>
  typeof ticks === "string" && /^[1-9][0-9]{0,29}$/.test(ticks);
const kinds = new Set(["native", "host", "manager", "gateway"]);
const childrenKey = (value) =>
  [...value.children].sort((a, b) => a - b).join(",");

export async function inspectLinuxProcess(pid) {
  if (!pidValid(pid)) throw Error("resource process PID invalid");
  const root = `/proc/${pid}`;
  const [info, text, status, tasks] = await Promise.all([
    stat(root),
    readFile(`${root}/stat`, "utf8"),
    readFile(`${root}/status`, "utf8"),
    readdir(`${root}/task`),
  ]);
  const fields = text
    .slice(text.lastIndexOf(") ") + 2)
    .trim()
    .split(/\s+/);
  if (tasks.length > 4096) throw Error("resource task budget exceeded");
  const children = new Set();
  // A process may fork from a non-main thread. Read every task's direct children.
  for (const task of tasks) {
    if (!/^[1-9][0-9]*$/.test(task))
      throw Error("resource task identity invalid");
    const text = await readFile(`${root}/task/${task}/children`, "utf8");
    if (text.length > 65536) throw Error("resource child budget exceeded");
    for (const id of text.trim().split(/\s+/).filter(Boolean)) {
      if (!pidValid(Number(id))) throw Error("resource child PID invalid");
      children.add(Number(id));
      if (children.size > 256) throw Error("resource child budget exceeded");
    }
  }
  const rss = status.match(/^VmRSS:\s+(\d+) kB$/m);
  if (!rss && fields[0] !== "Z")
    throw Error("resource process RSS unavailable");
  return {
    pid,
    ppid: Number(fields[1]),
    startTicks: fields[19],
    uid: info.uid,
    state: fields[0],
    rssBytes: rss ? Number(rss[1]) * 1024 : 0,
    taskCount: tasks.length,
    children: [...children],
  };
}

/** Capture immediately from an owner's spawned child; this does not establish ownership. */
export async function captureProcessIdentity(pid) {
  const info = await inspectLinuxProcess(pid);
  if (
    info.uid !== process.getuid?.() ||
    !ticksValid(info.startTicks) ||
    info.state === "Z"
  )
    throw Error("owned resource process identity unavailable");
  return Object.freeze({ pid, startTicks: info.startTicks });
}

export function createRefreshResourceMonitor({
  service,
  roots = [],
  processLimit = 256,
  taskLimit = 4096,
  inspectProcess = inspectLinuxProcess,
}) {
  const record = service?.record;
  if (
    !UUID.test(record?.domain) ||
    !UUID.test(record?.generation) ||
    !pidValid(record?.pid) ||
    !ticksValid(record?.startTicks) ||
    typeof service.readRss !== "function" ||
    typeof inspectProcess !== "function"
  )
    throw Error("resource native identity required");
  if (
    !Number.isSafeInteger(processLimit) ||
    processLimit < 1 ||
    processLimit > 256 ||
    !Number.isSafeInteger(taskLimit) ||
    taskLimit < 1 ||
    taskLimit > 4096 ||
    !Array.isArray(roots) ||
    roots.length > 32
  )
    throw Error("resource scan budget invalid");
  const { domain, generation, pid, startTicks } = record;
  const owned = [
    { id: "native", kind: "native", pid, startTicks },
    ...roots.map((root) => {
      if (
        !root ||
        !UUID.test(root.id) ||
        !kinds.has(root.kind) ||
        root.kind === "native" ||
        !pidValid(root.pid) ||
        !ticksValid(root.startTicks) ||
        Object.keys(root).sort().join(",") !== "id,kind,pid,startTicks"
      )
        throw Error("resource owned process identity required");
      return { ...root };
    }),
  ];
  if (
    new Set(owned.map((root) => root.pid)).size !== owned.length ||
    new Set(owned.map((root) => root.id)).size !== owned.length
  )
    throw Error("duplicate resource root identity");
  const observed = new Map();
  let valid = true,
    busy = false,
    last = null;
  const assertValid = () => {
    if (!valid) throw Error("resource generation invalidated");
    const current = service.record;
    if (
      current.domain !== domain ||
      current.generation !== generation ||
      current.pid !== pid ||
      current.startTicks !== startTicks
    ) {
      valid = false;
      last = null;
      throw Error("resource native identity changed");
    }
  };
  const validate = (info, expectedPid) => {
    if (
      !info ||
      info.pid !== expectedPid ||
      info.uid !== process.getuid?.() ||
      !ticksValid(info.startTicks) ||
      !Number.isSafeInteger(info.ppid) ||
      info.ppid < 0 ||
      !/^[RSDZTtXxKWPI]$/.test(info.state) ||
      !Number.isSafeInteger(info.rssBytes) ||
      info.rssBytes < 0 ||
      !Array.isArray(info.children) ||
      info.children.length > processLimit ||
      info.children.some((id) => !pidValid(id) || id === expectedPid) ||
      new Set(info.children).size !== info.children.length ||
      !Number.isSafeInteger(info.taskCount ?? 1) ||
      (info.taskCount ?? 1) < 1
    )
      throw Error("resource process metadata unavailable");
    return info;
  };
  const verifyService = async () => {
    assertValid();
    const rss = await service.readRss(); // Also verifies the private record/socket/PID generation.
    if (!Number.isSafeInteger(rss) || rss < 0)
      throw Error("resource native RSS unavailable");
    assertValid();
  };
  return {
    async read() {
      assertValid();
      if (busy) throw Error("resource scan in progress");
      busy = true;
      last = null;
      try {
        await verifyService();
        const entries = new Map(),
          parents = new Map(),
          queue = [];
        const add = (info) => {
          if (entries.has(info.pid)) return;
          if (entries.size >= processLimit)
            throw Error("resource process budget exceeded");
          entries.set(info.pid, info);
          queue.push(info);
        };
        for (const root of owned) {
          const info = validate(await inspectProcess(root.pid), root.pid);
          if (info.startTicks !== root.startTicks || info.state === "Z")
            throw Error("resource root process identity unavailable");
          add(info);
        }
        // A previously observed owned child may have been reparented to init.
        // Keep counting it, without adopting a later process that reused its PID.
        for (const [id, ticks] of observed) {
          if (entries.has(id)) continue;
          let info;
          try {
            info = await inspectProcess(id);
          } catch (error) {
            if (error.code === "ENOENT" || error.code === "ESRCH") continue;
            throw error;
          }
          if (info.startTicks !== ticks || info.state === "Z") continue;
          add(validate(info, id));
        }
        for (let index = 0; index < queue.length; index++) {
          const parent = queue[index];
          for (const id of parent.children) {
            if (parents.has(id) && parents.get(id) !== parent.pid)
              throw Error("resource process ancestry changed");
            parents.set(id, parent.pid);
            const info =
              entries.get(id) ?? validate(await inspectProcess(id), id);
            if (info.ppid !== parent.pid)
              throw Error("resource process ancestry changed");
            add(info);
          }
        }
        for (const id of parents.keys()) {
          const path = new Set();
          let ancestor = id;
          while (parents.has(ancestor)) {
            if (path.has(ancestor))
              throw Error("resource process ancestry cycle");
            path.add(ancestor);
            ancestor = parents.get(ancestor);
          }
        }
        let rssBytes = 0,
          taskCount = 0;
        for (const [id, before] of entries) {
          const after = validate(await inspectProcess(id), id);
          if (
            before.startTicks !== after.startTicks ||
            before.ppid !== after.ppid ||
            (before.state === "Z") !== (after.state === "Z") ||
            childrenKey(before) !== childrenKey(after)
          )
            throw Error("resource process tree changed during measurement");
          rssBytes += Math.max(before.rssBytes, after.rssBytes);
          taskCount += Math.max(before.taskCount ?? 1, after.taskCount ?? 1);
          if (!Number.isSafeInteger(rssBytes) || taskCount > taskLimit)
            throw Error("resource measurement budget exceeded");
        }
        await verifyService();
        assertValid();
        observed.clear();
        for (const [id, info] of entries)
          if (info.state !== "Z") observed.set(id, info.startTicks);
        last = Object.freeze({
          domain,
          generation,
          complete: true,
          accounting: "process-rss-sum",
          rssBytes,
          processCount: entries.size,
          taskCount,
          measuredAt: performance.now(),
          roots: Object.freeze(owned.map((root) => Object.freeze({ ...root }))),
        });
        return last;
      } catch (error) {
        last = null;
        if (!valid) throw Error("resource generation invalidated");
        // Do not expose process paths or payloads in product status.
        throw Object.assign(
          Error(
            "resource measurement unavailable: " +
              (/(?:budget|changed|ancestry|identity)/.exec(
                error.message,
              )?.[0] ?? "process"),
          ),
          { code: "REFRESH_RESOURCES_UNAVAILABLE" },
        );
      } finally {
        busy = false;
      }
    },
    invalidate() {
      valid = false;
      last = null;
    },
    snapshot() {
      return last
        ? { ...last, available: valid }
        : {
            domain,
            generation,
            available: false,
            rssBytes: null,
            processCount: null,
          };
    },
  };
}
