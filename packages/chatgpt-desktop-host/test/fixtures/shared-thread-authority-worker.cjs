"use strict";
const net = require("node:net"),
  { randomUUID } = require("node:crypto");
const {
  createSharedThreadAuthorityClient,
} = require("../../src/shared-thread-authority-channel.cjs");
const socket = net.createConnection(process.env.SOCKET),
  viewId = process.env.VIEW,
  threadId = process.env.THREAD,
  attemptId = randomUUID();
let client, binding, controller;
const frame = {
  id: `thread/resume:${randomUUID()}`,
  method: "thread/resume",
  params: { threadId, excludeTurns: true },
};
socket.once("connect", () => {
  client = createSharedThreadAuthorityClient({
    socket,
    profileId: process.env.PROFILE,
    generation: process.env.GENERATION,
  });
  process.send({ type: "ready" });
});
process.on("message", async (message) => {
  try {
    if (message.type === "authorize") {
      binding = await client.resolveBinding({
        viewId,
        hostId: "local",
        threadId,
      });
      controller = new AbortController();
      const accepted = await client.authorizeRequest(binding, frame, {
        attemptId,
        signal: controller.signal,
        deadline: performance.now() + 5000,
      });
      process.send({ type: "authorized", accepted });
    } else if (message.type === "dispatch") {
      let accepted = false;
      try {
        accepted = await client.dispatchRequest(frame);
      } catch {}
      process.send({ type: "dispatched", accepted });
    } else if (message.type === "cancel") {
      controller.abort();
      process.send({ type: "cancelled" });
    } else if (message.type === "close") {
      client.close();
      process.disconnect();
    }
  } catch {
    process.send({ type: "error" });
  }
});
