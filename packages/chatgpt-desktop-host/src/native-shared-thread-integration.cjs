"use strict";
const { createHash } = require("node:crypto");
const { createNativeDesktopAccountObserver } = require("./native-desktop-account-observer.cjs");
const {
  createNativeSharedThreadRouter,
} = require("./native-shared-thread-routing.cjs");
const {
  createSharedThreadAuthorityClient,
  createSharedAuthorityMemoryBudget,
} = require("./shared-thread-authority-channel.cjs");
const {createNativeDirectoryIpc,isDirectoryFrame}=require("./shared-directory-ipc.cjs");
const {createNativeCatalogRelay,isCatalogFrame}=require("./shared-catalog-ipc.cjs");
const {
  createSharedThreadAuthorityWire,
  isSharedThreadAuthorityFrame,
} = require("./shared-thread-authority-wire.cjs");
const denied = () =>
  Object.assign(new Error("Shared thread integration unavailable"), {
    code: "SHARED_NAV_UNAVAILABLE",
  });

// Constructed only by the explicitly configured native owner. Runtime and
// account authority are finally checked again by the remote host-side gate.
function createNativeSharedThreadIntegration(options = {}) {
  const {
    profileId,
    generation,
    getRecord,
    getOwnedRecord,
    verifyRuntimeSync,
    sendToView,
    sendFrame,
    onEvent,
    desktopAccountObservation = false,
    requireSourceToken = false,
    verifyThreadReadCliIdentitySync,
    enableSubmission = false,
  } = options;
  if (
    [getRecord, getOwnedRecord, verifyRuntimeSync, sendToView, sendFrame].some(
      (x) => typeof x !== "function",
    ) ||
    (verifyThreadReadCliIdentitySync !== undefined && typeof verifyThreadReadCliIdentitySync !== "function") ||
    (onEvent !== undefined && typeof onEvent !== "function") || typeof desktopAccountObservation !== "boolean" || typeof requireSourceToken !== "boolean" || typeof enableSubmission !== "boolean"
  )
    throw denied();
  const wire = createSharedThreadAuthorityWire({ side: "native", sendFrame });
  const eventHandlers = new Set(),
    sharedRequests = new Map(),
    sharedEvents = new Map(),
    approvalPending = new Map(),
    usedApprovalActions = new Set(),
    sharedEligibleOwners = new WeakSet();
  const memoryBudget=createSharedAuthorityMemoryBudget();
  let client,
    router,
    directory,
    catalog,
    submission,
    disposed = false;
  const current = () => {
    try {
      return (
        !disposed && client?.active === true && verifyRuntimeSync() === true
      );
    } catch {
      return false;
    }
  };
  const accountObserver = desktopAccountObservation ? createNativeDesktopAccountObserver({
    profileId, generation, verifyRuntimeSync: current, sendFrame,
    verifyThreadReadCliIdentitySync,
    onRevoke:()=>{directory?.revoke();directory=undefined;catalog?.revoke();},
  }) : null;
  try {
    client = createSharedThreadAuthorityClient({
      socket: wire.stream,
      profileId,
      generation,
      memoryBudget,
      onEvent: (binding, attemptId, frame, eventId, deliveryCount) => {
        if (!current() || !router?.isFollowing(binding, attemptId)) return;
        if (onEvent) return onEvent(binding, frame, eventId, deliveryCount);
        return deliverEvent(binding, attemptId, frame, eventId, deliveryCount);
      },
    });
    router = createNativeSharedThreadRouter({
      profileId,
      generation,
      getRecord,
      getOwnedRecord,
      verifyRuntimeSync: current,
      requireSourceToken,
      resolveBinding: (record, { hostId, threadId, sourceToken }, control) =>
        client.resolveBinding(
          { viewId: record.viewId, hostId, threadId, ...(sourceToken === undefined ? {} : {sourceToken}) },
          control,
        ),
      verifyBinding: async () => current(),
      verifyBindingSync: () => current() && (!accountObserver || accountObserver.verifyCurrentSync()),
      authorizeRequest: (binding, frame, control) =>
        client.authorizeRequest(binding, frame, control),
      onConnected: (binding, control) => client.follow(binding, control),
      onRetired: (attemptId) => {
        for (const value of approvalPending.values())
          if (value.attemptId === attemptId) value.controller.abort();
        for (const value of sharedRequests.values()) value.targets.delete(attemptId);
        client.unfollow(attemptId);
      },
      sendToView,
    });
    if (enableSubmission) submission = require("./native-shared-thread-submission.cjs").createNativeSharedThreadSubmission({
      profileId,generation,getRecord,getOwnedRecord,verifyCurrentSync:current,sendToView,sendFrame,router
    });
  } catch (error) {
    client?.close();
    wire.close();
    throw error;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    submission?.dispose();
    router.dispose();
    catalog?.close();catalog=undefined;
    directory?.close();directory=undefined;
    accountObserver?.dispose();
    eventHandlers.clear();
    for (const value of approvalPending.values()) value.controller.abort();
    approvalPending.clear();
    sharedRequests.clear();
    for (const value of sharedEvents.values()) clearTimeout(value.timer);
    sharedEvents.clear();
    client.close();
    wire.close();
  }
  function registerHostEvents(owner, manager, handlers) {
    if (
      !current() ||
      !owner?.connection ||
      typeof owner.connection.registerHostEventHandler !== "function" ||
      typeof manager?.getHostId !== "function" ||
      typeof handlers?.onNotification !== "function" ||
      typeof handlers?.onRequest !== "function"
    )
      throw denied();
    const hostId = manager.getHostId();
    if (typeof hostId !== "string" || !hostId) throw denied();
    const sharedEventHost = hostId === "local" || hostId === "kanban-shared-cli";
    if (sharedEventHost && eventHandlers.size >= 16) throw denied();
    const release = owner.connection.registerHostEventHandler(handlers);
    if (typeof release !== "function") throw denied();
    let releaseAccount = () => {};
    if (hostId === "local" && accountObserver) {
      try { releaseAccount = accountObserver.attach(owner); }
      catch (error) { release(); throw error; }
    }
    const value = { owner, hostId, handlers };
    if (sharedEventHost) {
      eventHandlers.add(value);
      sharedEligibleOwners.add(owner);
    }
    return () => {
      eventHandlers.delete(value);
      releaseAccount();
      release();
    };
  }
  function deliverEvent(binding, attemptId, frame, eventId, deliveryCount) {
    const matching = Array.from(eventHandlers).filter(
      (value) => value.hostId === binding.hostId,
    );
    if (matching.length !== 1) throw denied();
    const target = matching[0];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(eventId ?? "") ||
        !Number.isSafeInteger(deliveryCount) || deliveryCount < 1 || deliveryCount > 32) throw denied();
    const fingerprint = createHash("sha256").update(JSON.stringify(frame)).digest("hex");
    let event = sharedEvents.get(eventId), duplicate = false;
    if (event) {
      if (event.owner !== target.owner || event.threadId !== binding.threadId ||
          event.hostId !== binding.hostId || event.fingerprint !== fingerprint ||
          event.deliveryCount !== deliveryCount || event.attempts.has(attemptId)) throw denied();
      duplicate = true;
    } else if (deliveryCount > 1) {
      if (sharedEvents.size >= 64) throw denied();
      event = { owner: target.owner, threadId: binding.threadId, hostId: binding.hostId,
        fingerprint, deliveryCount, attempts: new Set(), timer: setTimeout(() => sharedEvents.delete(eventId), 35000) };
      event.timer.unref?.();
      sharedEvents.set(eventId, event);
    }
    if (event) {
      event.attempts.add(attemptId);
      if (event.attempts.size === event.deliveryCount) {
        clearTimeout(event.timer);
        sharedEvents.delete(eventId);
      }
    }
    if (Object.hasOwn(frame, "id")) {
      const key = `${typeof frame.id}:${frame.id}`;
      const prior = sharedRequests.get(key);
      if (prior) {
        if (
          prior.owner !== target.owner ||
          prior.threadId !== binding.threadId ||
          prior.method !== frame.method ||
          prior.fingerprint !== fingerprint
        )
          throw denied();
        const existing = prior.targets.get(attemptId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(binding)) throw denied();
        if (!existing) {
          if (prior.targets.size >= 16) throw denied();
          prior.targets.set(attemptId, binding);
        }
        return;
      }
      if (sharedRequests.size >= 8192) throw denied();
      sharedRequests.set(key, {
        owner: target.owner,
        method: frame.method,
        targets: new Map([[attemptId, binding]]),
        requestId: frame.id,
        threadId: binding.threadId,
        turnId: frame.params?.turnId,
        itemId: frame.params?.itemId,
        fingerprint,
      });
      if (target.handlers.onRequest(frame) !== true) throw denied();
    } else {
      if (duplicate) return;
      target.handlers.onNotification(frame, undefined);
      if (frame.method === "serverRequest/resolved") {
        const request = sharedRequests.get(
          `${typeof frame.params.requestId}:${frame.params.requestId}`,
        );
        if (request && request.threadId === frame.params.threadId)
          request.resolved = true;
      }
    }
  }
  function isSharedServerResponse(owner, frame) {
    if (owner && sharedEligibleOwners.has(owner) && !current()) return true;
    if (!frame || !Object.hasOwn(frame, "id")) return false;
    return (
      sharedRequests.get(`${typeof frame.id}:${frame.id}`)?.owner === owner
    );
  }
  async function approvalIntent(sender, message) {
    const fields = [
      "type",
      "v",
      "action",
      "actionId",
      "profileId",
      "generation",
      "viewId",
      "hostId",
      "threadId",
      "requestId",
      "itemId",
      "decision",
      "sequence",
      "epoch",
    ];
    const invalid = () => {
      try {
        const record = getOwnedRecord(sender);
        if (
          current() &&
          record &&
          getRecord(record.senderId) === record &&
          record.window?.webContents === sender &&
          record.failed !== true &&
          !record.window.isDestroyed() &&
          !sender.isDestroyed() &&
          message?.viewId === record.viewId &&
          message?.profileId === profileId &&
          message?.generation === generation &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            message?.actionId ?? "",
          ) &&
          Number.isSafeInteger(message?.sequence) &&
          typeof message?.epoch === "string"
        )
          sendToView(record, {
            type: "kanban-shared-approval-result",
            actionId: message.actionId,
            sequence: message.sequence,
            epoch: message.epoch,
            state: "denied",
          });
      } catch {}
      return Object.freeze({ state: "denied" });
    };
    if (
      !current() ||
      !message ||
      typeof message !== "object" ||
      Array.isArray(message) ||
      Object.keys(message).sort().join(",") !== fields.sort().join(",") ||
      message.type !== "kanban-shared-approval-intent" ||
      message.v !== 1 ||
      message.action !== "approval" ||
      message.profileId !== profileId ||
      message.generation !== generation ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        message.actionId ?? "",
      ) ||
      usedApprovalActions.has(message.actionId) ||
      usedApprovalActions.size >= 8192
    )
      return invalid();
    let decision;
    try {
      const raw = JSON.stringify(message.decision);
      if (!raw || Buffer.byteLength(raw) > 60000) return invalid();
      decision = JSON.parse(raw);
    } catch {
      return invalid();
    }
    if (accountObserver && !accountObserver.verifyCurrentSync()) return invalid();
    const follower = router.findFollower(sender, message);
    const key = `${typeof message.requestId}:${message.requestId}`;
    const request = sharedRequests.get(key);
    if (
      !follower ||
      !request ||
      request.resolved === true ||
      JSON.stringify(request.targets.get(follower.attemptId)) !== JSON.stringify(follower.binding) ||
      request.threadId !== message.threadId ||
      request.itemId !== message.itemId ||
      typeof request.turnId !== "string" ||
      !request.turnId ||
      ![
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
      ].includes(request.method) ||
      approvalPending.has(key)
    )
      return invalid();
    const controller = new AbortController();
    const pending = { controller, attemptId: follower.attemptId };
    approvalPending.set(key, pending);
    usedApprovalActions.add(message.actionId);
    let state = "denied";
    try {
      await client.replyApproval(
        {
          binding: follower.binding,
          attemptId: follower.attemptId,
          actionId: message.actionId,
          requestId: request.requestId,
          turnId: request.turnId,
          itemId: request.itemId,
          method: request.method,
          decision,
        },
        { signal: controller.signal, deadline: performance.now() + 30000 },
      );
      state = "resolved";
    } catch (error) {
      state =
        error?.code === "SHARED_DAEMON_OUTCOME_UNKNOWN" ? "unknown" : "denied";
    }
    if (approvalPending.get(key) === pending) approvalPending.delete(key);
    if (!current() || !router.isFollowing(follower.binding, follower.attemptId))
      return Object.freeze({ state: "unknown" });
    try {
      sendToView(getOwnedRecord(sender), {
        type: "kanban-shared-approval-result",
        actionId: message.actionId,
        sequence: message.sequence,
        epoch: message.epoch,
        state,
      });
    } catch {
      return Object.freeze({ state: "unknown" });
    }
    return Object.freeze({ state });
  }
  function receive(frame) {
    if (submission && ["shared-create-reply","shared-send-reply"].includes(frame?.type)) {
      if (!submission.receive(frame)) throw denied();
      return;
    }
    if(isCatalogFrame(frame,{side:"host",profileId,generation})){
      if(!catalog||!catalog.receive(frame))throw denied();
      return;
    }
    if (isDirectoryFrame(frame,{side:"host",profileId,generation})) {
      if (!current() || !accountObserver?.verifyCurrentSync()) throw denied();
      if (!directory) {
        if (frame.type !== "shared-directory-request") throw denied();
        directory=createNativeDirectoryIpc({profileId,generation,sendFrame,
          verifyCurrentSync:()=>current()&&accountObserver.verifyCurrentSync(),
          execute:(...args)=>accountObserver.executeDirectory(...args),
          reserveBytes:memoryBudget.reserveBytes,releaseBytes:memoryBudget.releaseBytes});
      }
      if (!directory.receive(frame)) throw denied();
      if (!directory.active) directory=undefined;
      return;
    }
    if (
      !current() ||
      !isSharedThreadAuthorityFrame(frame, {
        side: "host",
        profileId,
        generation,
      })
    ) {
      dispose();
      throw denied();
    }
    wire.receive(frame);
    if (frame.type !== "shared-reply") return;
    try {
      Promise.resolve(
        sendFrame({
          v: 1,
          type: "shared-reply-ack",
          profileId,
          generation,
          requestId: frame.requestId,
        }),
      ).catch(dispose);
    } catch {
      dispose();
      throw denied();
    }
  }
  async function exchangeRequest(frame) {
    if (!current()) throw denied();
    const result = await client.exchangeRequest(frame);
    if (!current()) {
      dispose();
      throw denied();
    }
    return result;
  }
  function catalogRelay(){
    if(!current()||!accountObserver?.verifyCurrentSync())throw denied();
    if(!catalog)catalog=createNativeCatalogRelay({profileId,generation,getRecord,getOwnedRecord,sendToView,sendFrame,
      verifyCurrentSync:()=>current()&&accountObserver.verifyCurrentSync(),reserveBytes:memoryBudget.reserveBytes,releaseBytes:memoryBudget.releaseBytes});
    return catalog;
  }
  const catalogRequest=(sender,message)=>{try{return catalogRelay().request(sender,message)}catch{return false}};
  const catalogAck=(sender,message)=>{try{return catalogRelay().ack(sender,message)}catch{return false}};
  const catalogCancel=(sender,message)=>{try{return catalogRelay().cancel(sender,message)}catch{return false}};
  const retire=sender=>{catalog?.retire(sender);return submission ? submission.retire(sender) : router.retire(sender)};
  return Object.freeze({
    lifecycle: submission?.lifecycle ?? router.lifecycle,
    createIntent: (sender,message) => submission ? submission.createIntent(sender,message) : Promise.resolve(false),
    sendIntent: (sender,message) => submission ? submission.sendIntent(sender,message) : Promise.resolve(false),
    withStart: (...args) => { if (!submission) throw denied(); return submission.withStart(...args); },
    withSend: (...args) => { if (!submission) throw denied(); return submission.withSend(...args); },
    runPreparedSend: (...args) => { if (!submission) throw denied(); return submission.runPreparedSend(...args); },
    intent: router.intent,
    approvalIntent,
    withResume: router.withResume,
    guardRequest: router.guardRequest,
    prepareRequest: submission?.prepareRequest ?? router.prepareRequest,
    retire,
    catalogRequest,
    catalogAck,
    catalogCancel,
    receive,
    dispatchRequest: client.dispatchRequest,
    exchangeRequest,
    registerHostEvents,
    verifyAccountSync:()=>current()&&accountObserver?.verifyCurrentSync()===true,
    isSharedServerResponse,
    dispose,
  });
}
module.exports = { createNativeSharedThreadIntegration };
