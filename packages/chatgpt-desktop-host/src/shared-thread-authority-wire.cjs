"use strict";
const { Duplex } = require("node:stream");
const MAX_LINE = 64 * 1024,
  MAX_QUEUED = 8 * 1024 * 1024;
const outgoing = Object.freeze({
  native: new Set([
    "shared-account-observation",
    "shared-account-revoked",
    "shared-authorize",
    "shared-approval",
    "shared-cancel",
    "shared-cancel-binding",
    "shared-reply-ack",
    "shared-dispatch",
    "shared-exchange",
    "shared-rpc-ack",
    "shared-follow",
    "shared-unfollow",
    "shared-event-ack",
  ]),
  host: new Set(["shared-reply", "shared-rpc-chunk", "shared-event-chunk"]),
});
const invalid = () =>
  Object.assign(new Error("Private authority wire unavailable"), {
    code: "SHARED_AUTHORITY_WIRE_INVALID",
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, keys) =>
  object(x) &&
  Object.keys(x).sort().join(",") === keys.slice().sort().join(",");
const atom = (x) =>
  typeof x === "string" &&
  x.length > 0 &&
  x.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(x);
function isSharedThreadAuthorityFrame(
  frame,
  { side, profileId, generation } = {},
) {
  try {
    if (
      !Object.hasOwn(outgoing, side) ||
      !UUID.test(profileId ?? "") ||
      !UUID.test(generation ?? "") ||
      !object(frame) ||
      frame.v !== 1 ||
      frame.profileId !== profileId ||
      frame.generation !== generation ||
      !outgoing[side].has(frame.type) ||
      Buffer.byteLength(JSON.stringify(frame)) > MAX_LINE
    )
      return false;
    const base = ["v", "type", "profileId", "generation"];
    if (frame.type === "shared-account-observation")
      return exact(frame,[...base,"revision","observationId","fingerprint","expiresAtMs"]) &&
        Number.isSafeInteger(frame.revision) && frame.revision >= 0 && UUID.test(frame.observationId ?? "") &&
        /^[0-9a-f]{64}$/.test(frame.fingerprint ?? "") && Number.isSafeInteger(frame.expiresAtMs) && frame.expiresAtMs > 0;
    if (frame.type === "shared-account-revoked")
      return exact(frame,[...base,"revision","observationId"]) && Number.isSafeInteger(frame.revision) &&
        frame.revision >= 0 && UUID.test(frame.observationId ?? "");
    if (frame.type === "shared-rpc-ack" || frame.type === "shared-event-ack")
      return (
        exact(frame, [...base, "requestId", "sequence"]) &&
        UUID.test(frame.requestId ?? "") &&
        Number.isSafeInteger(frame.sequence) &&
        frame.sequence > 0
      );
    if (
      frame.type === "shared-rpc-chunk" ||
      frame.type === "shared-event-chunk"
    )
      return (
        exact(
          frame,
          frame.type === "shared-event-chunk"
            ? [
                ...base,
                "requestId",
                "sequence",
                "final",
                "data",
                "attemptId",
                "binding",
                "eventId",
                "deliveryCount",
              ]
            : [...base, "requestId", "sequence", "final", "data"],
        ) &&
        (frame.type !== "shared-event-chunk" ||
          (UUID.test(frame.attemptId ?? "") && object(frame.binding) &&
            UUID.test(frame.eventId ?? "") && Number.isSafeInteger(frame.deliveryCount) &&
            frame.deliveryCount >= 1 && frame.deliveryCount <= 32)) &&
        UUID.test(frame.requestId ?? "") &&
        Number.isSafeInteger(frame.sequence) &&
        frame.sequence > 0 &&
        typeof frame.final === "boolean" &&
        typeof frame.data === "string" &&
        frame.data.length > 0 &&
        frame.data.length <= 43692 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)
      );
    if (frame.type === "shared-cancel")
      return (
        exact(frame, [...base, "attemptId"]) && UUID.test(frame.attemptId ?? "")
      );
    if (frame.type === "shared-unfollow")
      return (
        exact(frame, [...base, "attemptId"]) && UUID.test(frame.attemptId ?? "")
      );
    if (frame.type === "shared-follow")
      return (
        exact(frame, [...base, "requestId", "attemptId"]) &&
        UUID.test(frame.requestId ?? "") &&
        UUID.test(frame.attemptId ?? "")
      );
    if (
      frame.type === "shared-cancel-binding" ||
      frame.type === "shared-reply-ack"
    )
      return (
        exact(frame, [...base, "requestId"]) && UUID.test(frame.requestId ?? "")
      );
    if (!UUID.test(frame.requestId ?? "")) return false;
    if (frame.type === "shared-dispatch" || frame.type === "shared-exchange")
      return (
        exact(frame, [...base, "requestId", "frame"]) && object(frame.frame)
      );
    if (frame.type === "shared-approval")
      return (
        exact(frame, [
          ...base,
          "requestId",
          "binding",
          "attemptId",
          "actionId",
          "approvalRequestId",
          "turnId",
          "itemId",
          "method",
          "decision",
          "deadlineMono",
        ]) &&
        object(frame.binding) &&
        UUID.test(frame.attemptId ?? "") &&
        UUID.test(frame.actionId ?? "") &&
        (atom(frame.approvalRequestId) ||
          (Number.isSafeInteger(frame.approvalRequestId) &&
            frame.approvalRequestId >= 0)) &&
        atom(frame.turnId) &&
        atom(frame.itemId) &&
        [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
        ].includes(frame.method) &&
        Number.isSafeInteger(frame.deadlineMono)
      );
    if (frame.type === "shared-authorize" && frame.operation === "bind")
      return (
        exact(frame, [
          ...base,
          "requestId",
          "operation",
          "viewId",
          "hostId",
          "threadId",
          ...(Object.hasOwn(frame, "sourceToken") ? ["sourceToken"] : []),
        ]) &&
        UUID.test(frame.viewId ?? "") &&
        UUID.test(frame.threadId ?? "") &&
        atom(frame.hostId) &&
        (!Object.hasOwn(frame, "sourceToken") || (typeof frame.sourceToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(frame.sourceToken)))
      );
    if (frame.type === "shared-authorize" && frame.operation === "request")
      return (
        exact(frame, [
          ...base,
          "requestId",
          "operation",
          "binding",
          "attemptId",
          "frame",
          "deadlineMono",
        ]) &&
        object(frame.binding) &&
        UUID.test(frame.attemptId ?? "") &&
        object(frame.frame) &&
        Number.isSafeInteger(frame.deadlineMono)
      );
    if (frame.type === "shared-reply")
      return (
        typeof frame.ok === "boolean" &&
        (frame.ok
          ? exact(frame, [...base, "requestId", "ok"]) ||
            (exact(frame, [...base, "requestId", "ok", "binding"]) &&
              object(frame.binding))
          : exact(frame, [...base, "requestId", "ok", "code"]) &&
            ["denied", "unknown"].includes(frame.code))
      );
    return false;
  } catch {
    return false;
  }
}

// Turns only the fixed authority frames into a bounded Duplex for the common
// channel implementation. sendFrame must use the existing authenticated,
// ordered native-owner IPC; it must never be exposed as a browser RPC.
function createSharedThreadAuthorityWire({ side, sendFrame } = {}) {
  if (!Object.hasOwn(outgoing, side) || typeof sendFrame !== "function")
    throw invalid();
  const inbound = outgoing[side === "native" ? "host" : "native"];
  let ended = false;
  function encode(frame, allowed) {
    if (
      !frame ||
      typeof frame !== "object" ||
      Array.isArray(frame) ||
      frame.v !== 1 ||
      !allowed.has(frame.type)
    )
      throw invalid();
    let bytes;
    try {
      bytes = Buffer.from(JSON.stringify(frame) + "\n");
    } catch {
      throw invalid();
    }
    if (bytes.length > MAX_LINE + 1) throw invalid();
    return bytes;
  }
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      try {
        if (
          ended ||
          !Buffer.isBuffer(chunk) ||
          chunk.length > MAX_LINE + 1 ||
          chunk.at(-1) !== 10 ||
          chunk.indexOf(10) !== chunk.length - 1
        )
          throw invalid();
        const frame = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            chunk.subarray(0, -1),
          ),
        );
        encode(frame, outgoing[side]);
        Promise.resolve(sendFrame(frame)).then(
          () => callback(),
          () => callback(invalid()),
        );
      } catch {
        callback(invalid());
      }
    },
    destroy(_error, callback) {
      ended = true;
      callback();
    },
  });
  function receive(frame) {
    if (ended || stream.destroyed) throw invalid();
    let bytes;
    try {
      bytes = encode(frame, inbound);
    } catch (error) {
      stream.destroy();
      throw error;
    }
    if (stream.readableLength + bytes.length > MAX_QUEUED) {
      stream.destroy();
      throw invalid();
    }
    stream.push(bytes);
  }
  function close() {
    if (!ended) stream.destroy();
  }
  return Object.freeze({ stream, receive, close });
}
module.exports = {
  createSharedThreadAuthorityWire,
  isSharedThreadAuthorityFrame,
};
