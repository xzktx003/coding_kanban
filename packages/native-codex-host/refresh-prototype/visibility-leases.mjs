// Metadata-only page protection. No model messages, credentials or history are retained.
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { validateNativeScope } from "./native-scope.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuid = (value) => typeof value === "string" && UUID.test(value);
const digest = (value) => createHash("sha256").update(value).digest();
const unavailable = () =>
  Object.assign(Error("visibility lease unavailable"), {
    code: "VISIBILITY_LEASE_UNAVAILABLE",
  });
const shape = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === keys;

export function createVisibleLeaseController({
  manager,
  profileId,
  leaseGraceMs = 60000,
  maxLeases = 64,
}) {
  if (
    !uuid(profileId) ||
    ["snapshot", "scopeForThread", "open", "disconnect", "onInvalidated"].some(
      (key) => typeof manager?.[key] !== "function",
    )
  )
    throw Error("verified native visibility manager and profile required");
  if (
    !Number.isSafeInteger(leaseGraceMs) ||
    leaseGraceMs < 1 ||
    leaseGraceMs > 300000 ||
    !Number.isSafeInteger(maxLeases) ||
    maxLeases < 1 ||
    maxLeases > 64
  )
    throw Error("bounded visibility lease configuration required");
  const records = new Map();
  const serviceScope = validateNativeScope(manager.serviceScope);
  let closed = false,
    pending = 0,
    closing;
  const assertAvailable = () => {
    const state = manager.snapshot();
    if (closed || state.ready !== true || state.authorizationBound !== true)
      throw Error("native visibility manager unavailable");
  };
  const release = async (record, id) => {
    if (!id || !record.groups.has(id)) return;
    await manager.disconnect(id);
    record.groups.delete(id);
  };
  const retire = async (record) => {
    if (record.retiring) return record.retiring;
    record.expired = true;
    record.epoch++;
    clearTimeout(record.timer);
    const connection = record.connection;
    record.connection = null;
    try {
      connection?.onReplaced?.();
    } catch {
      /* Closing only the previous page. */
    }
    record.retiring = (async () => {
      await record.tail;
      for (const id of [...record.groups]) {
        try {
          await release(record, id);
        } catch {
          record.issue = true;
        }
      }
      if (!record.groups.size) records.delete(record.id);
    })();
    return record.retiring;
  };
  let unobserve = () => {};
  const controller = {
    profileId,
    serviceScope,
    async attach(input, { assertCurrent, onReplaced } = {}) {
      assertAvailable();
      const resume =
        Object.hasOwn(input ?? {}, "leaseId") ||
        Object.hasOwn(input ?? {}, "token");
      if (
        !shape(
          input,
          resume ? "instanceId,leaseId,origin,token" : "instanceId,origin",
        ) ||
        !uuid(input.instanceId) ||
        typeof input.origin !== "string" ||
        input.origin.length > 2048 ||
        typeof assertCurrent !== "function" ||
        (onReplaced !== undefined && typeof onReplaced !== "function")
      )
        throw Error("exact visible page identity required");
      let origin;
      try {
        origin = new URL(input.origin);
      } catch {
        throw Error("exact visible page origin required");
      }
      if (
        !["https:", "http:"].includes(origin.protocol) ||
        origin.origin !== input.origin
      )
        throw Error("exact visible page origin required");
      await assertCurrent();
      assertAvailable();
      let record, token;
      if (resume) {
        if (
          !uuid(input.leaseId) ||
          typeof input.token !== "string" ||
          !/^([0-9a-f]{64})$/.test(input.token)
        )
          throw unavailable();
        record = records.get(input.leaseId);
        if (
          !record ||
          record.expired ||
          record.origin !== input.origin ||
          record.instanceId !== input.instanceId ||
          !timingSafeEqual(record.tokenHash, digest(input.token))
        )
          throw unavailable();
        token = input.token;
      } else {
        if (records.size >= maxLeases)
          throw Error("visibility lease budget exceeded");
        token = randomBytes(32).toString("hex");
        record = {
          id: randomUUID(),
          tokenHash: digest(token),
          origin: input.origin,
          instanceId: input.instanceId,
          epoch: 0,
          connection: null,
          timer: null,
          expired: false,
          groups: new Set(),
          consumerId: null,
          ids: [],
          tail: Promise.resolve(),
          issue: false,
        };
        records.set(record.id, record);
      }
      const previous = record.connection,
        epoch = ++record.epoch;
      clearTimeout(record.timer);
      record.timer = null;
      const connection = { onReplaced };
      record.connection = connection;
      try {
        previous?.onReplaced?.();
      } catch {
        /* A superseded page cannot veto replacement. */
      }
      let sequence = 0,
        busy = false;
      const assertOwn = () => {
        if (
          record.expired ||
          record.epoch !== epoch ||
          record.connection !== connection
        )
          throw Error("visibility connection superseded");
        if (record.issue) throw Error("visibility cleanup unavailable");
        assertAvailable();
      };
      const verify = async () => {
        assertOwn();
        await assertCurrent();
        assertOwn();
      };
      return {
        identity: Object.freeze({ leaseId: record.id, token }),
        update(value) {
          try {
            assertOwn();
            if (
              !shape(value, "sequence,threadIds") ||
              !Number.isSafeInteger(value.sequence) ||
              value.sequence <= sequence
            )
              throw Error("monotonic visibility sequence required");
            if (
              !Array.isArray(value.threadIds) ||
              value.threadIds.length > 64 ||
              value.threadIds.some((id) => !uuid(id)) ||
              new Set(value.threadIds).size !== value.threadIds.length
            )
              throw Error("bounded exact visible threads required");
            if (busy || pending >= 64)
              throw Error("visibility operation budget exceeded");
          } catch (error) {
            return Promise.reject(error);
          }
          sequence = value.sequence;
          busy = true;
          pending++;
          const ids = [...value.threadIds].sort(),
            nextId = randomUUID();
          const operation = record.tail
            .then(async () => {
              await verify();
              if (
                ids.length === record.ids.length &&
                ids.every((id, index) => id === record.ids[index])
              )
                return;
              const keys = [];
              for (const id of ids) {
                keys.push(await manager.scopeForThread(id));
                await verify();
              }
              try {
                for (const key of keys) {
                  await verify();
                  record.groups.add(nextId);
                  await manager.open(key, { consumerId: nextId });
                  await verify();
                }
                const previousId = record.consumerId;
                record.consumerId = keys.length ? nextId : null;
                record.ids = ids;
                try {
                  await release(record, previousId);
                } catch (error) {
                  record.issue = true;
                  throw error;
                }
              } catch (error) {
                if (record.consumerId !== nextId) {
                  try {
                    await release(record, nextId);
                  } catch {
                    record.issue = true;
                  }
                }
                throw error;
              }
            })
            .finally(() => {
              busy = false;
              pending--;
            });
          record.tail = operation.catch(() => {});
          return operation;
        },
        disconnect() {
          if (
            record.epoch !== epoch ||
            record.connection !== connection ||
            record.expired
          )
            return;
          record.connection = null;
          record.epoch++;
          record.timer = setTimeout(() => {
            void retire(record);
          }, leaseGraceMs);
          record.timer.unref();
        },
      };
    },
    snapshot() {
      const state = manager.snapshot();
      return {
        available:
          !closed && state.ready === true && state.authorizationBound === true,
        leases: records.size,
        connected: [...records.values()].filter((r) => r.connection).length,
        pending,
        issueCount: [...records.values()].filter((r) => r.issue).length,
      };
    },
    close() {
      if (closing) return closing;
      closed = true;
      unobserve();
      closing = Promise.all([...records.values()].map(retire)).then(() => ({
        unreleasedConsumers: [...records.values()].reduce(
          (n, r) => n + r.groups.size,
          0,
        ),
      }));
      return closing;
    },
  };
  unobserve = manager.onInvalidated(() => {
    void controller.close();
  });
  return controller;
}
