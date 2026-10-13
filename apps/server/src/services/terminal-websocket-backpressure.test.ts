import assert from "node:assert/strict";
import test from "node:test";

import { createBoundedTerminalWebSocketSender } from "./terminal-websocket-backpressure.js";

test("bounded terminal websocket sender closes before exceeding the output queue limit", () => {
  const sent: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const socket = {
    bufferedAmount: 9,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
    send(frame: string) {
      sent.push(frame);
    },
  };
  const send = createBoundedTerminalWebSocketSender(socket, {
    maxBufferedBytes: 10,
  });

  send("ok");

  assert.deepEqual(sent, []);
  assert.deepEqual(closed, [
    { code: 1013, reason: "terminal output backpressure" },
  ]);
});

test("bounded terminal websocket sender forwards frames while under the queue limit", () => {
  const sent: string[] = [];
  const socket = {
    bufferedAmount: 3,
    close() {
      throw new Error("socket should stay open");
    },
    send(frame: string) {
      sent.push(frame);
    },
  };
  const send = createBoundedTerminalWebSocketSender(socket, {
    maxBufferedBytes: 10,
  });

  send("ok");

  assert.deepEqual(sent, ["ok"]);
});

test("bounded terminal websocket sender allows a large legal replay below the default queue budget", () => {
  const sent: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const socket = {
    bufferedAmount: 0,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
    send(frame: string) {
      sent.push(frame);
    },
  };
  const send = createBoundedTerminalWebSocketSender(socket);
  const largeReplayFrame = "x".repeat(2 * 1024 * 1024);

  send(largeReplayFrame);

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.length, largeReplayFrame.length);
  assert.deepEqual(closed, []);
});

test("bounded terminal websocket sender closes beyond the default queue budget", () => {
  const sent: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const socket = {
    bufferedAmount: 8 * 1024 * 1024,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
    send(frame: string) {
      sent.push(frame);
    },
  };
  const send = createBoundedTerminalWebSocketSender(socket);

  send("overflow");

  assert.deepEqual(sent, []);
  assert.deepEqual(closed, [
    { code: 1013, reason: "terminal output backpressure" },
  ]);
});

test("bounded terminal websocket sender latches closed after backpressure", () => {
  const sent: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const socket = {
    bufferedAmount: 9,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
      this.bufferedAmount = 0;
    },
    send(frame: string) {
      sent.push(frame);
    },
  };
  const send = createBoundedTerminalWebSocketSender(socket, {
    maxBufferedBytes: 10,
  });

  send("overflow");
  send("later");

  assert.equal(send.isClosed(), true);
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, [
    { code: 1013, reason: "terminal output backpressure" },
  ]);
});

test("bounded terminal websocket sender does not send when readyState is already closed", () => {
  const sent: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const socket = {
    bufferedAmount: 0,
    readyState: 3,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
    send(frame: string) {
      sent.push(frame);
    },
  };
  const send = createBoundedTerminalWebSocketSender(socket);

  send("late");

  assert.equal(send.isClosed(), true);
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
});
