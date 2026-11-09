"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { createHash } = require("node:crypto");
const {
  types: { isPromise },
} = require("node:util");

const ORIGINAL_SHA256 =
  "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";
const ADAPTED_SHA256 =
  "362690aa7cebb9bcdf64a4037cfb6fe1e1ab09b2f4a547db67059502bd963c70";
const MAX_INFLIGHT_RESUMES = 1024;
const PATCHES = Object.freeze([
  Object.freeze([
    "appServerManagers:this.appServerManagersService,httpFetch:",
    "appServerManagers:globalThis.__kanbanBindAppServerManagers(this.appServerManagersService,e),httpFetch:",
  ]),
  Object.freeze([
    "requestDynamicToolsAndHostedAutomationAppForThreadStart(e,t,r){let n=this.windowManager.getPrimaryWindow();",
    "requestDynamicToolsAndHostedAutomationAppForThreadStart(e,t,r){let n=globalThis.__kanbanSelectDynamicToolsWindow();void 0===n&&(n=this.windowManager.getPrimaryWindow());",
  ]),
]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const failure = (code) =>
  Object.assign(new Error("Dynamic tools routing unavailable"), { code });

/** Independently version-pin both exact native entry points. */
function adaptDynamicToolsChunk({ body } = {}) {
  if (!Buffer.isBuffer(body) || digest(body) !== ORIGINAL_SHA256)
    throw failure("DYNAMIC_TOOLS_DIGEST_MISMATCH");
  let text = body.toString("utf8");
  for (const [before, after] of PATCHES) {
    const index = text.indexOf(before);
    if (index < 0 || text.indexOf(before, index + 1) !== -1)
      throw failure("DYNAMIC_TOOLS_PATCH_MISMATCH");
    text = text.slice(0, index) + after + text.slice(index + before.length);
  }
  const adapted = Buffer.from(text, "utf8");
  if (digest(adapted) !== ADAPTED_SHA256)
    throw failure("DYNAMIC_TOOLS_PATCH_MISMATCH");
  return Object.freeze({
    body: adapted,
    originalSha256: ORIGINAL_SHA256,
    adaptedSha256: ADAPTED_SHA256,
  });
}

/** Bind each original AppHost manager service to the exact owned sender. */
function createDynamicToolsRouter({
  getRecord,
  getOwnedRecord,
  withResume,
  withStart,
  withSend,
} = {}) {
  if (
    typeof getRecord !== "function" ||
    typeof getOwnedRecord !== "function" ||
    (withResume !== undefined && typeof withResume !== "function") ||
    (withStart !== undefined && typeof withStart !== "function") ||
    (withSend !== undefined && typeof withSend !== "function")
  )
    throw failure("DYNAMIC_TOOLS_INVALID_CONFIG");
  const scope = new AsyncLocalStorage();
  const inflight = new Map();
  let inflightCount = 0;
  function live(record, sender) {
    try {
      return Boolean(
        record &&
        sender &&
        record.window &&
        record.window.webContents === sender &&
        getRecord(record.senderId) === record &&
        !record.failed &&
        !record.window.isDestroyed() &&
        !sender.isDestroyed(),
      );
    } catch {
      return false;
    }
  }
  function selectWindow() {
    const context = scope.getStore();
    if (!context) return undefined;
    if (!context.active || !live(context.record, context.sender)) return null;
    return context.record.window;
  }
  function acquireResume(record, host, params) {
    let property;
    try {
      property =
        params &&
        typeof params === "object" &&
        Object.getOwnPropertyDescriptor(params, "conversationId");
    } catch {
      throw failure("DYNAMIC_TOOLS_INVALID_REQUEST");
    }
    const id =
      property && Object.hasOwn(property, "value") ? property.value : undefined;
    if (
      typeof host !== "string" ||
      !host ||
      host.length > 256 ||
      typeof id !== "string" ||
      !id ||
      id.length > 1024
    )
      throw failure("DYNAMIC_TOOLS_INVALID_REQUEST");
    let byId = inflight.get(host);
    let entry = byId?.get(id);
    if (entry && entry.record !== record)
      throw failure("DYNAMIC_TOOLS_VIEW_CONFLICT");
    if (!entry) {
      if (inflightCount >= MAX_INFLIGHT_RESUMES)
        throw failure("DYNAMIC_TOOLS_PENDING_LIMIT");
      if (!byId) {
        byId = new Map();
        inflight.set(host, byId);
      }
      entry = { record, count: 0 };
      byId.set(id, entry);
      inflightCount++;
    }
    entry.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--entry.count === 0 && byId.get(id) === entry) {
        byId.delete(id);
        inflightCount--;
        if (!byId.size && inflight.get(host) === byId) inflight.delete(host);
      }
    };
  }
  function bindManagers(managers, sender) {
    const record = sender && getOwnedRecord(sender);
    if (!record) return managers;
    if (
      !managers ||
      typeof managers !== "object" ||
      record.window?.webContents !== sender
    )
      throw failure("DYNAMIC_TOOLS_INVALID_CONFIG");
    const methods = new Map(),
      managerCache = new WeakMap(),
      callbackCache = new WeakMap();
    function wrapManager(manager, host) {
      if (!manager || typeof manager !== "object")
        throw failure("DYNAMIC_TOOLS_INVALID_RESPONSE");
      let byHost = managerCache.get(manager);
      if (!byHost) {
        byHost = new Map();
        managerCache.set(manager, byHost);
      }
      if (byHost.has(host)) return byHost.get(host);
      const cached = new Map(), coordinators = new WeakMap();
      function wrapCoordinator(coordinator) {
        if (!coordinator || typeof coordinator !== "object") throw failure("DYNAMIC_TOOLS_INVALID_RESPONSE");
        if (coordinators.has(coordinator)) return coordinators.get(coordinator);
        const methods = new Map();
        const proxy = new Proxy(coordinator, { get(target, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== "function" || key === "constructor") return value;
          const previous = methods.get(key); if (previous?.value === value) return previous.bound;
          const bound = key !== "sendMessage" ? value.bind(target) : function (...args) {
            if (!live(record, sender)) throw failure("DYNAMIC_TOOLS_VIEW_UNAVAILABLE");
            const input = args[0], message = input?.message, originalContext = message?.context;
            if (!input || typeof input !== "object" || !message || typeof message !== "object" || !originalContext || typeof originalContext !== "object") throw failure("DYNAMIC_TOOLS_INVALID_REQUEST");
            const context = { ...originalContext }, attempt = context.__kanbanSharedSendAttempt;
            delete context.__kanbanSharedSendAttempt;
            const callContext = { record, sender, active: true };
            let result;
            try {
              result = scope.run(callContext, () => withSend(sender, host, { conversationId: input.conversationId, __kanbanSharedSendAttempt: attempt }, (_clean, bindPrepared) => {
                const prepare = args[1];
                if (typeof prepare !== "function") throw failure("DYNAMIC_TOOLS_INVALID_REQUEST");
                const boundPrepare = typeof bindPrepared !== "function" ? prepare : async function (...prepareArgs) {
                  // Original RPC callbacks return RpcPromise thenables, which
                  // the original w7 facade also awaits before using a packet.
                  return bindPrepared(await Reflect.apply(prepare, this, prepareArgs));
                };
                return Reflect.apply(value, target, [{ ...input, message: { ...message, context } }, boundPrepare, ...args.slice(2)]);
              }));
            } catch (error) { callContext.active = false; throw error; }
            if (isPromise(result)) void Promise.prototype.then.call(result, () => { callContext.active = false; }, () => { callContext.active = false; });
            else callContext.active = false;
            return result;
          };
          methods.set(key, { value, bound }); return bound;
        } });
        coordinators.set(coordinator, proxy); return proxy;
      }
      const proxy = new Proxy(manager, {
        get(target, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== "function" || key === "constructor")
            return value;
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          if (
            descriptor &&
            descriptor.configurable === false &&
            Object.hasOwn(descriptor, "value") &&
            descriptor.writable === false
          )
            throw failure("DYNAMIC_TOOLS_INVALID_RESPONSE");
          const previous = cached.get(key);
          if (previous?.value === value) return previous.bound;
          const bound =
            typeof key !== "string"
              ? value.bind(target)
              : function (...args) {
                  if (!live(record, sender))
                    throw failure("DYNAMIC_TOOLS_VIEW_UNAVAILABLE");
                  const release =
                    key === "resumeConversation"
                      ? acquireResume(record, host, args[0])
                      : () => {};
                  const context = { record, sender, active: true };
                  const finish = () => {
                    context.active = false;
                    release();
                  };
                  let result;
                  try {
                    result = scope.run(context, () => {
                      if (key === "startTurn" && host === "kanban-shared-cli" && withSend) {
                        return withSend(sender, host, { ...args[1], conversationId: args[0] }, (clean) => {
                          const { conversationId, ...options } = clean;
                          if (conversationId !== args[0]) throw failure("DYNAMIC_TOOLS_INVALID_REQUEST");
                          return Reflect.apply(value, target, [args[0], options, ...args.slice(2)]);
                        });
                      }
                      if (key === "startConversation" && host === "kanban-shared-cli" && withStart) {
                        return withStart(sender, host, args[0], (params, settleCreated) => {
                          const originalOptions = args[1] ?? {};
                          const wrapCreated = (callback) => {
                            const wrapped = async (...createdArgs) => {
                              await settleCreated(createdArgs[0]);
                              return callback?.(...createdArgs);
                            };
                            if (typeof callback?.dup === "function") wrapped.dup = () => wrapCreated(callback.dup());
                            if (typeof callback?.[Symbol.dispose] === "function") wrapped[Symbol.dispose] = () => callback[Symbol.dispose]();
                            return wrapped;
                          };
                          return Reflect.apply(value, target, [params,
                            { ...originalOptions, afterConversationCreated: wrapCreated(originalOptions.afterConversationCreated) },
                            ...args.slice(2)]);
                        });
                      }
                      return (
                      key === "resumeConversation" &&
                      withResume &&
                      args[0] !== null &&
                      (typeof args[0] === "object" || typeof args[0] === "function") &&
                      Object.hasOwn(args[0], "__kanbanSharedConnectAttempt")
                        ? withResume(sender, host, args[0], (params) =>
                            Reflect.apply(value, target, [
                              params,
                              ...args.slice(1),
                            ]),
                          )
                        : Reflect.apply(value, target, args)
                      );
                    });
                  } catch (error) {
                    finish();
                    throw error;
                  }
                  if (key === "getTurnCoordinator" && host === "kanban-shared-cli" && withSend) {
                    result = isPromise(result) ? result.then(wrapCoordinator) : wrapCoordinator(result);
                  }
                  if (isPromise(result))
                    void Promise.prototype.then.call(result, finish, finish);
                  else finish();
                  return result;
                };
          cached.set(key, { value, bound });
          return bound;
        },
      });
      byHost.set(host, proxy);
      return proxy;
    }
    function wrapState(state, host) {
      if (!state || typeof state !== "object" || state.status !== "ready")
        return state;
      if (!live(record, sender))
        throw failure("DYNAMIC_TOOLS_VIEW_UNAVAILABLE");
      return { ...state, manager: wrapManager(state.manager, host) };
    }
    function wrapCallback(callback, host) {
      if (typeof callback !== "function")
        throw failure("DYNAMIC_TOOLS_INVALID_REQUEST");
      let byHost = callbackCache.get(callback);
      if (!byHost) {
        byHost = new Map();
        callbackCache.set(callback, byHost);
      }
      if (byHost.has(host)) return byHost.get(host);
      const adapted = function (...args) {
        if (!live(record, sender))
          throw failure("DYNAMIC_TOOLS_VIEW_UNAVAILABLE");
        return Reflect.apply(callback, this, [
          wrapState(args[0], host),
          ...args.slice(1),
        ]);
      };
      if (typeof callback.dup === "function")
        Object.defineProperty(adapted, "dup", {
          value: () =>
            wrapCallback(Reflect.apply(callback.dup, callback, []), host),
        });
      if (typeof callback.onRpcBroken === "function")
        Object.defineProperty(adapted, "onRpcBroken", {
          value: (...args) =>
            Reflect.apply(callback.onRpcBroken, callback, args),
        });
      if (typeof callback[Symbol.dispose] === "function")
        Object.defineProperty(adapted, Symbol.dispose, {
          value: () => Reflect.apply(callback[Symbol.dispose], callback, []),
        });
      byHost.set(host, adapted);
      return adapted;
    }
    return new Proxy(managers, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function" || key === "constructor") return value;
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (
          descriptor &&
          descriptor.configurable === false &&
          Object.hasOwn(descriptor, "value") &&
          descriptor.writable === false
        )
          throw failure("DYNAMIC_TOOLS_INVALID_RESPONSE");
        const previous = methods.get(key);
        if (previous?.value === value) return previous.bound;
        let bound;
        if (key === "open")
          bound = function (host, ...rest) {
            if (!live(record, sender))
              throw failure("DYNAMIC_TOOLS_VIEW_UNAVAILABLE");
            return wrapState(
              Reflect.apply(value, target, [host, ...rest]),
              host,
            );
          };
        else if (key === "subscribe")
          bound = function (host, callback, ...rest) {
            if (!live(record, sender))
              throw failure("DYNAMIC_TOOLS_VIEW_UNAVAILABLE");
            return Reflect.apply(value, target, [
              host,
              wrapCallback(callback, host),
              ...rest,
            ]);
          };
        else bound = value.bind(target);
        methods.set(key, { value, bound });
        return bound;
      },
    });
  }
  return Object.freeze({ bindManagers, selectWindow });
}
module.exports = { createDynamicToolsRouter, adaptDynamicToolsChunk, PATCHES };
