import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createBrowserProjectFolderPicker } from "../src/browser-project-folder-picker.mjs";
const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
function fixture(initialActive = true, readyTimeoutMs = 500) {
  const dom = new JSDOM("<!doctype html><body></body>", {
      url: "http://localhost/",
    }),
    win = dom.window,
    sent = [],
    listeners = new Set();
  let token = {},
    active = initialActive;
  const lease = {
    getSnapshot: () => (active ? token : null),
    isCurrent: (x) => active && x === token,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const picker = createBrowserProjectFolderPicker({
    window: win,
    scopeLease: lease,
    readyTimeoutMs,
    sendMessage: (message) => sent.push(message),
  });
  const message = (data) =>
    win.dispatchEvent(new win.MessageEvent("message", { data }));
  const ack = (frame) =>
    message({
      type: "kanban-project-folder-lifecycle-ack",
      sequence: frame.sequence,
      epoch: frame.epoch,
    });
  return {
    win,
    sent,
    picker,
    message,
    ack,
    activate() {
      token = {};
      active = true;
      for (const f of listeners) f();
    },
    inactive() {
      active = false;
      for (const f of listeners) f();
    },
    close() {
      picker.dispose();
      dom.window.close();
    },
  };
}
const opening = (epoch, id = randomUUID()) => ({
  type: "kanban-project-folder-open",
  requestId: id,
  epoch,
  allowMultiple: false,
  roots: ["/work"],
});
test("ready waits for the dedicated current native ACK; an obsolete ACK cannot satisfy a newer activation", async () => {
  const f = fixture();
  try {
    const first = f.sent[0];
    assert.equal(first.type, "kanban-project-folder-lifecycle");
    assert.equal(first.sequence, 1);
    let ready = false;
    f.picker.ready().then(() => {
      ready = true;
    });
    f.activate();
    const second = f.sent[1];
    assert.equal(second.sequence, 2);
    assert.notEqual(second.epoch, first.epoch);
    f.ack(first);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ready, false);
    f.ack(second);
    await f.picker.ready();
    assert.equal(ready, true);
  } finally {
    f.close();
  }
});
test("a first late open from a retired activation is canceled, while the current epoch opens", async () => {
  const f = fixture();
  try {
    const first = f.sent[0];
    f.ack(first);
    await f.picker.ready();
    f.activate();
    const second = f.sent[1];
    f.ack(second);
    await new Promise((resolve) => setImmediate(resolve));
    const old = opening(first.epoch);
    f.message(old);
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    assert.deepEqual(f.sent.at(-1), {
      type: "kanban-project-folder-reply",
      requestId: old.requestId,
      epoch: first.epoch,
      action: "cancel",
    });
    f.message(opening(second.epoch));
    assert.ok(f.win.document.querySelector("[role=dialog]"));
  } finally {
    f.close();
  }
});
test("an already completed request cannot reopen in the same activation", async () => {
  const f = fixture();
  try {
    const lifecycle = f.sent[0];
    f.ack(lifecycle);
    await f.picker.ready();
    const request = opening(lifecycle.epoch);
    f.message(request);
    assert.ok(f.win.document.querySelector("[role=dialog]"));
    f.message({
      type: "kanban-project-folder-done",
      requestId: request.requestId,
      epoch: request.epoch,
    });
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    f.message(request);
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
  } finally {
    f.close();
  }
});
test("retired request IDs stay rejected after the small cancellation cache fills", async () => {
  const f = fixture();
  try {
    const lifecycle = f.sent[0],
      first = opening(lifecycle.epoch);
    f.message(first);
    for (let i = 0; i < 70; i++) f.message(opening(lifecycle.epoch));
    f.ack(lifecycle);
    await f.picker.ready();
    f.message(first);
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
  } finally {
    f.close();
  }
});
test("a matching ACK still waits for the latest lifecycle send to complete", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
      url: "http://localhost/",
    }),
    win = dom.window,
    listeners = new Set(),
    sent = [];
  let token = {},
    resolveOld,
    resolveCurrent;
  const lease = {
    getSnapshot: () => token,
    isCurrent: (x) => x === token,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const picker = createBrowserProjectFolderPicker({
    window: win,
    scopeLease: lease,
    readyTimeoutMs: 500,
    sendMessage: (frame) => {
      sent.push(frame);
      return new Promise((resolve) => {
        if (frame.sequence === 1) resolveOld = resolve;
        else resolveCurrent = resolve;
      });
    },
  });
  try {
    let ready = false;
    picker.ready().then(() => {
      ready = true;
    });
    token = {};
    for (const fn of listeners) fn();
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: {
          type: "kanban-project-folder-lifecycle-ack",
          sequence: sent[1].sequence,
          epoch: sent[1].epoch,
        },
      }),
    );
    resolveOld();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ready, false);
    resolveCurrent();
    await picker.ready();
    assert.equal(ready, true);
  } finally {
    picker.dispose();
    dom.window.close();
  }
});
test("a later lifecycle timeout reports failure and synchronously retires the dialog", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
      url: "http://localhost/",
    }),
    win = dom.window,
    listeners = new Set(),
    sent = [],
    failures = [];
  let token = {};
  const lease = {
    getSnapshot: () => token,
    isCurrent: (x) => x === token,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const picker = createBrowserProjectFolderPicker({
    window: win,
    scopeLease: lease,
    readyTimeoutMs: 30,
    sendMessage: (frame) => sent.push(frame),
    onFailure: (error) => failures.push(error),
  });
  try {
    const first = sent[0];
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: {
          type: "kanban-project-folder-lifecycle-ack",
          sequence: first.sequence,
          epoch: first.epoch,
        },
      }),
    );
    await picker.ready();
    const request = opening(first.epoch);
    win.dispatchEvent(new win.MessageEvent("message", { data: request }));
    assert.ok(win.document.querySelector("[role=dialog]"));
    token = {};
    for (const fn of listeners) fn();
    assert.equal(win.document.querySelector("[role=dialog]"), null);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(failures, [
      { code: "PROJECT_FOLDER_UI_LIFECYCLE_UNAVAILABLE" },
    ]);
    const latest = sent.findLast(
      (frame) => frame.type === "kanban-project-folder-lifecycle",
    );
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: {
          type: "kanban-project-folder-lifecycle-ack",
          sequence: latest.sequence,
          epoch: latest.epoch,
        },
      }),
    );
    win.dispatchEvent(
      new win.MessageEvent("message", { data: opening(latest.epoch) }),
    );
    assert.equal(win.document.querySelector("[role=dialog]"), null);
  } finally {
    picker.dispose();
    dom.window.close();
  }
});
test("an inactive ACK is a valid startup handshake; an old native without an ACK fails closed", async () => {
  const f = fixture(false);
  try {
    const init = f.sent[0];
    assert.equal(init.epoch, null);
    f.ack(init);
    await f.picker.ready();
  } finally {
    f.close();
  }
  const old = fixture(true, 15);
  try {
    await assert.rejects(old.picker.ready(), {
      code: "PROJECT_FOLDER_UI_LIFECYCLE_UNAVAILABLE",
    });
  } finally {
    old.close();
  }
});
