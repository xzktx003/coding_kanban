// Isolated metadata manager. Browser/CLI integration remains behind acceptance.
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createThreadPool } from "./thread-pool.mjs";
import { createNativePoolAdapter } from "./native-pool-adapter.mjs";
import {
  isAuthorizationBoundary,
  nativeAuthorizationIdentity,
} from "./authorization-boundary.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const lifecycle = (method) =>
  /^(thread\/(started|status\/changed|closed|archived|unarchived)|turn\/(started|completed)|serverRequest\/resolved)$/.test(
    method,
  ) || /requestApproval|requestUserInput|elicitation/.test(method);

export async function createRefreshManager({
  service,
  resourceMonitor,
  idleLimit = 10,
  memoryBudgetBytes,
  authorizationTimeoutMs = 15000,
}) {
  if (typeof resourceMonitor?.read !== "function")
    throw Error("explicit owned process resource monitor required");
  if (
    !Number.isSafeInteger(authorizationTimeoutMs) ||
    authorizationTimeoutMs < 1 ||
    authorizationTimeoutMs > 60000
  )
    throw Error("bounded native authorization timeout required");
  const { domain, generation, cliSha256 } = service.record;
  const known = new Map(),
    consumers = new Map(),
    refresh = new Set(),
    issues = new Map(),
    invalidationListeners = new Set();
  let pool,
    client,
    nativeClient,
    adapter,
    valid = true,
    ready = false,
    queue = Promise.resolve(),
    scheduled = false,
    closePromise,
    unavailableReason = null,
    resourceMeasurement = null;
  let initialAuthorization = true,
    initialAccountObserved = false,
    authorizationBound = false,
    resolveAccountNotice;
  const assertValid = () => {
    if (!valid) throw Error("native manager generation unavailable");
  };
  const invalidate = (reason) => {
    valid = false;
    ready = false;
    unavailableReason ??= reason;
    authorizationBound = false;
    resolveAccountNotice?.();
    refresh.clear();
    pool?.invalidate();
    for (const listener of invalidationListeners) {
      try { listener(unavailableReason); } catch { /* Observers cannot undo revocation. */ }
    }
    invalidationListeners.clear();
  };
  const closeOwnConnection = () => {
    if (!nativeClient) return Promise.resolve();
    closePromise ??= Promise.resolve().then(() => nativeClient.close());
    return closePromise;
  };
  let queued = 0;
  const serial = (work) => {
    if (queued >= 64)
      return Promise.reject(
        Error("native manager pending operation limit exceeded"),
      );
    queued++;
    const result = queue
      .then(() => {
        assertValid();
        return work();
      })
      .finally(() => {
        queued--;
      });
    queue = result.catch(() => {});
    return result;
  };
  const current = (id) =>
    pool?.snapshot().entries.find((entry) => entry.threadId === id);
  const removeEvicted = () => {
    const retained = new Set(
      pool.snapshot().entries.map((entry) => entry.threadId),
    );
    for (const id of known.keys())
      if (!retained.has(id)) {
        known.delete(id);
        issues.delete(id);
      }
  };
  const reconcile = async (id) => {
    const key = known.get(id);
    if (!key) return;
    const revision = client.revision;
    try {
      const value = await adapter.probe(key);
      if (!valid) return;
      if (client.revision !== revision) {
        refresh.add(id);
        return;
      }
      pool.observe(value);
      issues.delete(id);
    } catch {
      if (!valid) return;
      pool.observe({
        ...key,
        status: "unknown",
        pendingRequests: current(id)?.pendingRequests ?? 0,
      });
      issues.set(id, "native-state-unavailable");
    }
  };
  const schedule = () => {
    if (scheduled || !valid || !pool) return;
    scheduled = true;
    if (queued >= 64) {
      // Wait for already queued work to make room; an immediate microtask retry
      // would starve the native I/O needed to finish that same work.
      void queue.finally(() => {
        scheduled = false;
        if (valid && refresh.size) schedule();
      });
      return;
    }
    void serial(async () => {
      // Coalesce native state boundaries. Streaming body deltas never enter this queue.
      const ids = [...refresh];
      refresh.clear();
      for (const id of ids) await reconcile(id);
      await pool.trim();
      removeEvicted();
    })
      .catch(() => {})
      .finally(() => {
        scheduled = false;
        if (refresh.size && valid) schedule();
      });
  };
  const onLifecycle = (event) => {
    if (valid && initialAuthorization && event.method === "account/updated") {
      // The pinned native sends an initial workspace-routing snapshot to each
      // new connection. No thread RPC is allowed until actual account/read
      // identities agree across this notice. Login/OAuth changes still revoke.
      initialAccountObserved = true;
      resolveAccountNotice?.();
      return;
    }
    if (valid && isAuthorizationBoundary(event.method)) {
      // These notifications have no thread ID. They revoke this manager's
      // warm-readiness claim; never unsubscribe or stop the native tasks.
      invalidate("authorization-changed");
      void closeOwnConnection().catch(() => {});
      return;
    }
    if (
      !valid ||
      !lifecycle(event.method) ||
      !UUID.test(event.threadId) ||
      !known.has(event.threadId)
    )
      return;
    const key = known.get(event.threadId),
      entry = current(event.threadId);
    // A late read is not allowed to turn a just-arrived approval into idle.
    pool?.observe({
      ...key,
      status: "unknown",
      pendingRequests: entry?.pendingRequests ?? 0,
    });
    refresh.add(event.threadId);
    schedule();
  };
  try {
    nativeClient = await service.connect({
      name: "kanban_refresh_lifecycle",
      onLifecycle,
    });
    assertValid();
    client = {
      get revision() {
        return nativeClient.revision;
      },
      request(method, params, options = {}) {
        assertValid();
        return nativeClient.request(method, params, {
          ...options,
          beforeSend() {
            assertValid();
            options.beforeSend?.();
          },
        });
      },
      closed: nativeClient.closed,
      close: closeOwnConnection,
    };
    const firstAuthorization = nativeAuthorizationIdentity(
      await client.request("account/read", { refreshToken: false }),
      { domain, generation },
    );
    assertValid();
    if (firstAuthorization.kind === "chatgpt" && !initialAccountObserved) {
      let timer;
      try {
        await Promise.race([
          new Promise((resolve) => {
            resolveAccountNotice = resolve;
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  Error("initial native authorization notice unavailable"),
                ),
              authorizationTimeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        resolveAccountNotice = undefined;
      }
    }
    assertValid();
    const authorizationRevision = client.revision;
    const confirmedAuthorization = nativeAuthorizationIdentity(
      await client.request("account/read", { refreshToken: false }),
      { domain, generation },
    );
    assertValid();
    if (
      authorizationRevision !== client.revision ||
      firstAuthorization.fingerprint !== confirmedAuthorization.fingerprint
    )
      throw Error("native authorization changed during initial binding");
    initialAuthorization = false;
    authorizationBound = true;
    adapter = createNativePoolAdapter({
      client,
      domain,
      generation,
      cliVersion: "0.162.0-alpha.17.2",
      cliSha256,
      async readRss() {
        resourceMeasurement = null;
        assertValid();
        const value = await resourceMonitor.read();
        assertValid();
        if (
          value?.domain !== domain ||
          value.generation !== generation ||
          value.complete !== true ||
          value.accounting !== "process-rss-sum" ||
          !Number.isSafeInteger(value.rssBytes) ||
          value.rssBytes < 0 ||
          !Number.isSafeInteger(value.processCount) ||
          value.processCount < 1 ||
          value.processCount > 256 ||
          !Number.isSafeInteger(value.taskCount) ||
          value.taskCount < value.processCount ||
          value.taskCount > 4096 ||
          !Number.isFinite(value.measuredAt) ||
          value.measuredAt < 0 ||
          value.measuredAt > performance.now() ||
          performance.now() - value.measuredAt > 5000
        )
          throw Error("fresh owned resource measurement unavailable");
        resourceMeasurement = {
          rssBytes: value.rssBytes,
          processCount: value.processCount,
          taskCount: value.taskCount,
          measuredAt: value.measuredAt,
          accounting: value.accounting,
        };
        return value.rssBytes;
      },
    });
    pool = createThreadPool({
      domain,
      generation,
      idleLimit,
      memoryBudgetBytes,
      adapter,
    });
    // Recovery is a bounded read of loaded identities, never a history poll.
    const ids = new Set(),
      cursors = new Set();
    let cursor;
    for (let page = 0; ; page++) {
      if (page >= 16) throw Error("native loaded metadata budget exceeded");
      const result = await client.request("thread/loaded/list", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (
        !Array.isArray(result.data) ||
        result.data.some((id) => !UUID.test(id))
      )
        throw Error("native loaded identities unavailable");
      for (const id of result.data) ids.add(id);
      if (ids.size > 256) throw Error("native loaded identity budget exceeded");
      if (result.nextCursor === null) break;
      if (
        typeof result.nextCursor !== "string" ||
        result.nextCursor.length > 4096 ||
        cursors.has(result.nextCursor)
      )
        throw Error("native loaded cursor unavailable");
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    for (const id of ids) {
      const metadata = (
        await client.request("thread/read", {
          threadId: id,
          includeTurns: false,
        })
      )?.thread;
      if (metadata?.id !== id || typeof metadata.cwd !== "string")
        throw Error("native loaded thread scope unavailable");
      const key = {
        domain,
        generation,
        threadId: id,
        cwd: await realpath(metadata.cwd),
      };
      known.set(id, key);
      await pool.retain(key);
    }
    await pool.trim();
    removeEvicted();
    assertValid();
    ready = true;
    client.closed?.then(
      () => {
        invalidate("native-connection-lost");
      },
      () => {
        invalidate("native-connection-lost");
      },
    );
  } catch (error) {
    invalidate("initialization-failed");
    await closeOwnConnection();
    throw error;
  }
  const manager = {
    onInvalidated(listener) {
      if (typeof listener !== "function" || invalidationListeners.size >= 64)
        throw Error("bounded manager invalidation observer required");
      if (!valid) listener(unavailableReason);
      else invalidationListeners.add(listener);
      return () => invalidationListeners.delete(listener);
    },
    scopeForThread(threadId) {
      if (typeof threadId !== "string" || !UUID.test(threadId)) return Promise.reject(Error("exact thread UUID required"));
      return serial(async () => {
        const value = (await client.request("thread/read", {threadId,includeTurns:false}))?.thread;
        if (value?.id !== threadId || typeof value.cwd !== "string" || value.cwd.length > 4096 ||
          !isAbsolute(value.cwd) || /[\x00-\x1f\x7f]/.test(value.cwd))
          throw Error("native thread metadata scope unavailable");
        const cwd = await realpath(value.cwd);
        assertValid();
        if (known.has(threadId) && known.get(threadId).cwd !== cwd)
          throw Error("native thread cwd changed");
        return Object.freeze({domain,generation,threadId,cwd});
      });
    },
    open(key, { consumerId, warmOnly = false } = {}) {
      if (
        !key ||
        key.domain !== domain ||
        key.generation !== generation ||
        Object.keys(key).sort().join(",") !==
          "cwd,domain,generation,threadId" ||
        !UUID.test(key.threadId) ||
        typeof key.cwd !== "string" ||
        key.cwd.length > 4096 ||
        typeof warmOnly !== "boolean"
      )
        return Promise.reject(Error("exact native manager scope required"));
      key = {
        domain: key.domain,
        generation: key.generation,
        threadId: key.threadId,
        cwd: key.cwd,
      };
      // Announce an already verified visible consumer synchronously. A trim
      // may already be waiting on native I/O; its actual write must see this.
      if (!warmOnly) {
        if (!UUID.test(consumerId)) return Promise.reject(Error("exact visible consumer UUID required"));
        if (!valid || queued >= 64) return Promise.reject(Error("native manager unavailable or pending operation limit exceeded"));
        if (!consumers.has(consumerId) && consumers.size >= 256)
          return Promise.reject(Error("native manager consumer budget exceeded"));
        const previous = known.get(key.threadId);
        if (previous && previous.cwd !== key.cwd) return Promise.reject(Error("native thread cwd changed"));
        if (previous && current(key.threadId)) {
          pool.setVisible(key.threadId,consumerId,true);
          let ids=consumers.get(consumerId);
          if (!ids) consumers.set(consumerId,ids=new Set());
          ids.add(key.threadId);
        }
      }
      return serial(async () => {
        if (key?.domain !== domain || key?.generation !== generation)
          throw Error("native manager scope or generation mismatch");
        if (!warmOnly && !UUID.test(consumerId))
          throw Error("exact visible consumer UUID required");
        await pool.trim();
        removeEvicted();
        const before = await adapter.probe(key);
        // Native reads and ancestry checks may yield to a newly created host or
        // process. Refresh the complete resource measurement before admission.
        await pool.trim();
        removeEvicted();
        if (
          !known.has(key.threadId) &&
          warmOnly &&
          (issues.size > 0 || !pool.snapshot().warmAdmission) &&
          !["active", "waitingApproval", "waitingInput"].includes(before.status)
        )
          return { status: "admission-deferred", generation };
        if (!known.has(key.threadId) && known.size >= 256)
          throw Error("native manager identity budget exceeded");
        if (!warmOnly && !consumers.has(consumerId) && consumers.size >= 256)
          throw Error("native manager consumer budget exceeded");
        known.set(key.threadId, Object.freeze({ ...key }));
        const value = await pool.retain(key);
        if (!warmOnly) {
          pool.setVisible(key.threadId, consumerId, true);
          let ids = consumers.get(consumerId);
          if (!ids) {
            ids = new Set();
            consumers.set(consumerId, ids);
          }
          ids.add(key.threadId);
        }
        await pool.trim();
        removeEvicted();
        assertValid();
        return { ...value, warm: known.has(key.threadId) };
      });
    },
    disconnect(consumerId) {
      return serial(async () => {
        if (!UUID.test(consumerId)) throw Error("exact consumer UUID required");
        const ids = consumers.get(consumerId);
        consumers.delete(consumerId);
        for (const id of ids ?? [])
          if (known.has(id)) pool.setVisible(id, consumerId, false);
        await pool.trim();
        removeEvicted();
        assertValid();
      });
    },
    async settle() {
      do {
        await queue;
        await Promise.resolve();
      } while (scheduled || refresh.size);
    },
    snapshot() {
      const state = pool.snapshot();
      const resourcesFresh =
        valid &&
        resourceMeasurement !== null &&
        performance.now() >= resourceMeasurement.measuredAt &&
        performance.now() - resourceMeasurement.measuredAt <= 5000;
      return {
        ...state,
        ready: ready && valid,
        authorizationBound: authorizationBound && valid,
        unavailableReason,
        resources: {
          available: resourcesFresh,
          ...(resourcesFresh
            ? resourceMeasurement
            : { rssBytes: null, processCount: null, taskCount: null }),
        },
        issues: [...issues].map(([threadId, reason]) => ({ threadId, reason })),
        warmAdmission:
          valid &&
          ready &&
          resourcesFresh &&
          issues.size === 0 &&
          state.warmAdmission,
      };
    },
    close() {
      invalidate("manager-closed");
      return closeOwnConnection();
    },
  };
  if (refresh.size) schedule();
  return manager;
}
