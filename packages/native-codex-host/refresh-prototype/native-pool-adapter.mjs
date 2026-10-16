import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** The caller must verify these bytes before creating the private connection. */
export function createNativePoolAdapter({
  client,
  domain,
  generation,
  cliVersion,
  cliSha256,
  readRss,
  canonicalize = realpath,
  unloadTimeoutMs = 5000,
  pollMs = 50,
}) {
  if (
    cliVersion !== "0.162.0-alpha.17.2" ||
    cliSha256 !==
      "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4"
  )
    throw new Error("unverified native unsubscribe version");
  if (
    !UUID.test(domain) ||
    !UUID.test(generation) ||
    typeof readRss !== "function" ||
    typeof client?.request !== "function"
  )
    throw new Error("invalid native adapter scope");
  if (
    !Number.isSafeInteger(unloadTimeoutMs) ||
    unloadTimeoutMs < 1 ||
    unloadTimeoutMs > 60000 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 1 ||
    pollMs > 1000
  )
    throw new Error("invalid native unload limits");
  const validate = (key) => {
    if (
      !key ||
      key.domain !== domain ||
      key.generation !== generation ||
      !UUID.test(key.threadId)
    )
      throw new Error("native scope mismatch");
    if (
      typeof key.cwd !== "string" ||
      key.cwd.length > 4096 ||
      !isAbsolute(key.cwd) ||
      resolve(key.cwd) !== key.cwd ||
      /[\x00-\x1f\x7f]/.test(key.cwd)
    )
      throw new Error("canonical native cwd required");
  };
  const state = async (key, thread) => {
    if (
      thread?.id !== key.threadId ||
      typeof thread.cwd !== "string" ||
      (await canonicalize(thread.cwd)) !== key.cwd
    )
      throw new Error("native thread cwd or identity mismatch");
    const flags = Array.isArray(thread.status?.activeFlags)
      ? thread.status.activeFlags
      : [];
    const approval = flags.includes("waitingOnApproval"),
      input = flags.includes("waitingOnUserInput");
    const status =
      thread.status?.type === "idle"
        ? "idle"
        : thread.status?.type === "active"
          ? approval
            ? "waitingApproval"
            : input
              ? "waitingInput"
              : "active"
          : "unknown";
    return {
      generation,
      threadId: key.threadId,
      cwd: key.cwd,
      status,
      pendingRequests: approval || input ? 1 : 0,
      loaded: thread.status?.type !== "notLoaded",
    };
  };
  const probeOwn = async (key) => {
    validate(key);
    const result = await client.request("thread/read", {
      threadId: key.threadId,
      includeTurns: false,
    });
    const current = await state(key, result.thread);
    if (current.status !== "idle" || !current.loaded) return current;
    // An idle turn may still own a background command or autonomous goal.
    // Read only their metadata and retain no command or objective text.
    try {
      const terminals = await client.request(
        "thread/backgroundTerminals/list",
        { threadId: key.threadId, limit: 1 },
      );
      if (!Array.isArray(terminals?.data) || terminals.nextCursor === undefined)
        return { ...current, status: "unknown", resourceHold: "unknown" };
      if (terminals.data.length || terminals.nextCursor !== null)
        return { ...current, status: "active", resourceHold: "background" };
      const goal = (
        await client.request("thread/goal/get", { threadId: key.threadId })
      )?.goal;
      if (goal === null) return current;
      if (
        ["complete", "paused", "blocked", "budgetLimited"].includes(
          goal?.status,
        )
      )
        return current;
      return {
        ...current,
        status: goal?.status === "active" ? "active" : "unknown",
        resourceHold: "goal",
      };
    } catch {
      return { ...current, status: "unknown", resourceHold: "unknown" };
    }
  };
  const retain = async (key) => {
    // A read before acquiring the subscription prevents a supplied cwd from
    // attaching this manager to a different project's thread.
    await probe(key);
    const result = await client.request("thread/resume", {
      threadId: key.threadId,
      excludeTurns: true,
    });
    const retained = await state(key, result.thread);
    return {
      ...retained,
      ...(retained.status === "idle" ? await probe(key) : {}),
      retained: true,
    };
  };
  const loadedIds = async () => {
    let cursor;
    const seen = new Set(),
      ids = new Set();
    for (let page = 0; page < 16; page++) {
      const result = await client.request("thread/loaded/list", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (
        !Array.isArray(result.data) ||
        result.data.some((id) => !UUID.test(id))
      )
        throw new Error("native loaded list invalid");
      for (const id of result.data) ids.add(id);
      if (ids.size > 256)
        throw new Error("native family metadata budget exceeded");
      const next = result.nextCursor;
      if (next === null) return ids;
      if (typeof next !== "string" || next.length > 4096 || seen.has(next))
        throw new Error("native loaded cursor invalid");
      seen.add(next);
      cursor = next;
    }
    throw new Error("native loaded list page budget exceeded");
  };
  const loaded = async (threadId) => (await loadedIds()).has(threadId);
  const parent = (thread) => {
    const source = thread.source;
    const candidates = [
      thread.parentThreadId,
      source?.subAgent?.thread_spawn?.parent_thread_id,
      source?.subAgent?.threadSpawn?.parentThreadId,
      source?.subagent?.thread_spawn?.parent_thread_id,
      source?.subagent?.threadSpawn?.parentThreadId,
    ];
    const ids = candidates.filter(
      (value) => value !== undefined && value !== null,
    );
    if (
      ids.some((value) => typeof value !== "string" || !UUID.test(value)) ||
      new Set(ids).size > 1
    )
      throw new Error("native descendant identity unavailable");
    if (ids.length) return ids[0];
    if (
      ["cli", "vscode", "exec", "appServer"].includes(source) ||
      (source &&
        typeof source === "object" &&
        typeof source.custom === "string")
    )
      return null;
    throw new Error("native ancestry unavailable");
  };
  const probe = async (key) => {
    const current = await probeOwn(key);
    if (current.status !== "idle" || !current.loaded) return current;
    try {
      const ids = await loadedIds(),
        metadata = new Map();
      const read = async (id) => {
        if (!metadata.has(id)) {
          if (metadata.size >= 256)
            throw new Error("native ancestry metadata budget exceeded");
          const thread = (
            await client.request("thread/read", {
              threadId: id,
              includeTurns: false,
            })
          )?.thread;
          if (thread?.id !== id)
            throw new Error("native ancestry identity mismatch");
          metadata.set(id, thread);
        }
        return metadata.get(id);
      };
      for (const id of ids) {
        if (id === key.threadId) continue;
        const path = new Set();
        let ancestor = id;
        while (ancestor !== null && ancestor !== key.threadId) {
          if (path.has(ancestor)) throw new Error("native ancestry cycle");
          if (path.size >= 64)
            throw new Error("native ancestry depth exceeded");
          path.add(ancestor);
          ancestor = parent(await read(ancestor));
        }
        if (ancestor !== key.threadId) continue;
        for (const member of path) {
          if (!ids.has(member)) continue;
          const thread = await read(member);
          if (typeof thread.cwd !== "string")
            throw new Error("native descendant cwd unavailable");
          const child = await probeOwn({
            ...key,
            threadId: member,
            cwd: await canonicalize(thread.cwd),
          });
          if (child.status !== "idle" || child.pendingRequests)
            return {
              ...current,
              status: child.status,
              pendingRequests: child.pendingRequests,
              resourceHold: "descendant",
            };
        }
      }
      return current;
    } catch {
      return {
        ...current,
        status: "unknown",
        resourceHold: "ancestry-unknown",
      };
    }
  };
  return {
    idleOnlyUnsubscribe: true,
    readRss,
    probe,
    retain,
    async confirmReleased(key) {
      validate(key);
      const checkpoint = client.revision;
      if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) return false;
      const absent = !(await loaded(key.threadId));
      return absent && checkpoint === client.revision;
    },
    async unsubscribe(key, { beforeSend } = {}) {
      if (beforeSend !== undefined && typeof beforeSend !== "function")
        throw Error("native unsubscribe write guard required");
      const checkpoint = client.revision;
      const current = await probe(key);
      if (!current.loaded && !(await loaded(key.threadId)))
        return { released: true };
      if (current.status !== "idle" || current.pendingRequests)
        return { protected: true, retained: true, state: current };
      let receipt;
      try {
        receipt = await client.request(
          "thread/unsubscribe",
          { threadId: key.threadId },
          {
            beforeSend() {
              const checked = beforeSend?.();
              if (checkpoint !== client.revision)
                throw Object.assign(
                  new Error("Native lifecycle changed before unsubscribe"),
                  { code: "NATIVE_NOT_SENT" },
                );
              return checked;
            },
          },
        );
      } catch (error) {
        if (error.code === "NATIVE_NOT_SENT")
          return {
            protected: true,
            retained: true,
            state: {
              ...current,
              status: "unknown",
              resourceHold: "lifecycle-changed",
            },
          };
        throw error;
      }
      if (
        !["unsubscribed", "notSubscribed", "notLoaded"].includes(
          receipt?.status,
        )
      )
        throw new Error("unknown native unsubscribe receipt");
      const deadline = performance.now() + unloadTimeoutMs;
      do {
        if (!(await loaded(key.threadId))) return { released: true };
        const latest = await probe(key);
        if (!latest.loaded) {
          if (!(await loaded(key.threadId))) return { released: true };
          await delay(pollMs);
          continue;
        }
        if (latest.status !== "idle" || latest.pendingRequests)
          return { protected: true, retained: true, state: await retain(key) };
        await delay(pollMs);
      } while (performance.now() < deadline);
      // Other native clients may still subscribe. Never disconnect them,
      // interrupt, unload or falsely remove their running context from counts.
      throw new Error("native unsubscribe acknowledged; unload not confirmed");
    },
  };
}
