// Isolated lifecycle policy. The normal launcher does not enable this module.
import { isAbsolute, resolve } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = new Set([
  "idle",
  "active",
  "waitingApproval",
  "waitingInput",
  "unknown",
]);

export function createThreadPool({
  domain,
  generation,
  idleLimit = 10,
  memoryBudgetBytes,
  adapter,
}) {
  if (!UUID.test(domain) || !UUID.test(generation))
    throw new Error("exact domain and generation required");
  if (!Number.isSafeInteger(idleLimit) || idleLimit < 0)
    throw new Error("invalid idleLimit");
  if (!Number.isSafeInteger(memoryBudgetBytes) || memoryBudgetBytes <= 0)
    throw new Error("invalid memoryBudgetBytes");
  if (
    adapter?.idleOnlyUnsubscribe !== true ||
    ["probe", "unsubscribe", "readRss"].some(
      (method) => typeof adapter[method] !== "function",
    )
  )
    throw new Error("safe native unsubscribe adapter required");
  const entries = new Map();
  let valid = true;
  let sequence = 0;
  let pressure = false;
  let lastRss = null;
  let recoveryRequired = false;
  let queue = Promise.resolve();
  const assertValid = () => {
    if (!valid) throw new Error("pool generation invalidated");
  };
  const warmIdle = (entry) =>
    entry.status === "idle" && entry.pendingRequests === 0;
  const evictable = (entry) =>
    warmIdle(entry) && entry.consumers.size === 0 && !entry.error;
  const idleCount = () => [...entries.values()].filter(warmIdle).length;
  const validate = (value) => {
    if (!value || value.generation !== generation)
      throw new Error("stale native generation");
    if (!UUID.test(value.threadId))
      throw new Error("invalid native thread UUID");
    if (
      typeof value.cwd !== "string" ||
      !isAbsolute(value.cwd) ||
      value.cwd.length > 4096 ||
      value.cwd.trim() !== value.cwd ||
      resolve(value.cwd) !== value.cwd ||
      /[\x00-\x1f\x7f]/.test(value.cwd)
    )
      throw new Error("canonical cwd required");
    if (
      !STATES.has(value.status) ||
      !Number.isSafeInteger(value.pendingRequests) ||
      value.pendingRequests < 0
    )
      throw new Error("invalid native lifecycle state");
    const old = entries.get(value.threadId);
    if (old && old.key.cwd !== value.cwd)
      throw new Error("native thread cwd changed");
  };
  const observe = (value) => {
    assertValid();
    validate(value);
    const old = entries.get(value.threadId);
    if (old) {
      // State changes are not user activity and must not reorder the LRU.
      if (
        old.status !== value.status ||
        old.pendingRequests !== value.pendingRequests
      ) {
        old.status = value.status;
        old.pendingRequests = value.pendingRequests;
        old.revision++;
      }
      return;
    }
    entries.set(value.threadId, {
      key: Object.freeze({
        domain,
        generation,
        threadId: value.threadId,
        cwd: value.cwd,
      }),
      status: value.status,
      pendingRequests: value.pendingRequests,
      consumers: new Set(),
      used: ++sequence,
      revision: 0,
      error: null,
    });
  };
  const readRss = async () => {
    try {
      const rss = await adapter.readRss();
      if (!Number.isSafeInteger(rss) || rss < 0)
        throw new Error("native RSS unavailable");
      lastRss = rss;
      return rss;
    } catch (error) {
      lastRss = null;
      pressure = true;
      throw error;
    }
  };
  const trim = async () => {
    if (!valid || recoveryRequired) return;
    const examined = new Set();
    try {
      let rss = await readRss();
      while (valid && (idleCount() > idleLimit || rss > memoryBudgetBytes)) {
        const candidate = [...entries.values()]
          .filter((entry) => evictable(entry) && !examined.has(entry))
          .sort((a, b) => a.used - b.used)[0];
        if (!candidate) break;
        examined.add(candidate);
        const revision = candidate.revision;
        let current;
        try {
          current = await adapter.probe(candidate.key);
          validate(current);
          if (
            current.threadId !== candidate.key.threadId ||
            current.cwd !== candidate.key.cwd
          )
            throw new Error("native state identity mismatch");
        } catch {
          candidate.error = "native-state-unavailable";
          continue;
        }
        // An event or consumer may arrive while the native probe is in flight.
        // Keep the newer observation; never overwrite it with the older reply.
        if (!valid || candidate.revision !== revision || !evictable(candidate))
          continue;
        observe(current);
        if (!evictable(candidate)) continue;
        try {
          // Required adapter contract: unsubscribe only this manager's own
          // subscription. Native idle-only release protects a racing new turn;
          // no interrupt, archive, shutdown or client disconnection is allowed.
          const result = await adapter.unsubscribe(candidate.key, {
            beforeSend() {
              if (
                !valid ||
                candidate.revision !== revision ||
                !evictable(candidate)
              )
                throw Object.assign(
                  new Error(
                    "Pool consumer or state changed before unsubscribe",
                  ),
                  { code: "NATIVE_NOT_SENT" },
                );
            },
          });
          if (result?.protected === true && result.retained === true) {
            validate(result.state);
            if (
              result.state.threadId !== candidate.key.threadId ||
              result.state.cwd !== candidate.key.cwd
            )
              throw new Error("protected native state identity mismatch");
            if (valid && candidate.revision === revision) observe(result.state);
            rss = await readRss();
            continue;
          }
          if (!result || result.released !== true)
            throw new Error("unknown unsubscribe receipt");
          if (valid && candidate.revision === revision && evictable(candidate))
            entries.delete(candidate.key.threadId);
          else {
            // Native emits thread/closed for this successful unsubscribe too.
            // Reconfirm actual absence after that event, fencing both native
            // revision (adapter) and consumers/state (pool). Unknown receipts
            // never reach this branch and are never retried or cleared here.
            const confirmedRevision = candidate.revision;
            const mayConfirm =
              valid &&
              candidate.consumers.size === 0 &&
              candidate.pendingRequests === 0 &&
              ["idle", "unknown"].includes(candidate.status) &&
              typeof adapter.confirmReleased === "function";
            const confirmed =
              mayConfirm && (await adapter.confirmReleased(candidate.key));
            if (
              confirmed === true &&
              valid &&
              entries.get(candidate.key.threadId) === candidate &&
              candidate.revision === confirmedRevision &&
              candidate.consumers.size === 0 &&
              candidate.pendingRequests === 0
            )
              entries.delete(candidate.key.threadId);
            else {
              candidate.error = "subscription-recovery-required";
              recoveryRequired = true;
            }
          }
        } catch {
          // No automatic replay of a mutation whose receipt is unknown.
          candidate.error = "unsubscribe-uncertain";
          recoveryRequired = true;
        }
        if (recoveryRequired) break;
        rss = await readRss();
      }
      pressure = rss > memoryBudgetBytes || idleCount() > idleLimit;
    } catch {
      pressure = true;
    }
  };
  return {
    observe,
    retain(key) {
      const retain = async () => {
        assertValid();
        if (
          !key ||
          key.domain !== domain ||
          key.generation !== generation ||
          typeof adapter.retain !== "function"
        )
          throw new Error("native retention scope unavailable");
        const previous = entries.get(key.threadId);
        const revision = previous?.revision;
        const result = await adapter.retain(key);
        assertValid();
        validate(result);
        if (
          result?.retained !== true ||
          result.threadId !== key.threadId ||
          result.cwd !== key.cwd
        )
          throw new Error("native retention acknowledgement invalid");
        // Live lifecycle events may be newer than this retain response.
        if (
          entries.get(key.threadId) === previous &&
          (!previous || previous.revision === revision)
        )
          observe(result);
        const entry = entries.get(key.threadId);
        if (!entry) throw new Error("native retention generation changed");
        entry.error = null;
        entry.used = ++sequence;
        entry.revision++;
        recoveryRequired = [...entries.values()].some(
          (item) =>
            item.error === "unsubscribe-uncertain" ||
            item.error === "subscription-recovery-required",
        );
        const rss = await readRss();
        pressure = rss > memoryBudgetBytes || idleCount() > idleLimit;
        return {
          ...result,
          status: entry.status,
          pendingRequests: entry.pendingRequests,
        };
      };
      queue = queue.then(retain, retain);
      return queue;
    },
    touch(threadId) {
      assertValid();
      const entry = entries.get(threadId);
      if (!entry) return false;
      entry.used = ++sequence;
      entry.revision++;
      return true;
    },
    setVisible(threadId, clientId, visible) {
      assertValid();
      if (!UUID.test(clientId) || typeof visible !== "boolean")
        throw new Error("exact consumer UUID required");
      const entry = entries.get(threadId);
      if (!entry) throw new Error("native thread is not retained");
      const changed = visible
        ? !entry.consumers.has(clientId)
        : entry.consumers.has(clientId);
      if (!changed) return;
      if (visible) {
        entry.consumers.add(clientId);
        entry.used = ++sequence;
      } else entry.consumers.delete(clientId);
      entry.revision++;
    },
    trim() {
      queue = queue.then(trim, trim);
      return queue;
    },
    invalidate() {
      // Manager loss invalidates readiness, never native execution.
      valid = false;
    },
    snapshot() {
      return {
        domain,
        generation,
        valid,
        idleLimit,
        memoryBudgetBytes,
        rssBytes: lastRss,
        pressure,
        warmAdmission:
          valid &&
          lastRss !== null &&
          !pressure &&
          (idleCount() < idleLimit || [...entries.values()].some(evictable)) &&
          ![...entries.values()].some((entry) => entry.error),
        entries: [...entries.values()].map((entry) => ({
          key: { ...entry.key },
          threadId: entry.key.threadId,
          status: entry.status,
          pendingRequests: entry.pendingRequests,
          visibleConsumers: entry.consumers.size,
          lastUse: entry.used,
          error: entry.error,
        })),
      };
    },
  };
}
