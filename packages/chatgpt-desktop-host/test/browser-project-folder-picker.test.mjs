import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createBrowserProjectFolderPicker } from "../src/browser-project-folder-picker.mjs";
const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");

function fixture(initiallyActive = true) {
  const dom = new JSDOM(
    "<!doctype html><body><button id=previous>Previous</button></body>",
    { url: "http://localhost/" },
  );
  const win = dom.window,
    sent = [],
    subscribers = new Set();
  let valid = initiallyActive,
    token = {},
    lastLifecycle;
  const scopeLease = {
    getSnapshot: () => (valid ? token : null),
    isCurrent: (t) => valid && t === token,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
  const picker = createBrowserProjectFolderPicker({
    window: win,
    scopeLease,
    sendMessage: (message) => {
      if (message.type === "kanban-project-folder-lifecycle") {
        lastLifecycle = message;
        queueMicrotask(() =>
          win.dispatchEvent(
            new win.MessageEvent("message", {
              data: {
                type: "kanban-project-folder-lifecycle-ack",
                sequence: message.sequence,
                epoch: message.epoch,
              },
            }),
          ),
        );
      } else sent.push(message);
    },
  });
  function message(data, source = null) {
    win.dispatchEvent(new win.MessageEvent("message", { data, source }));
  }
  return {
    win,
    sent,
    picker,
    message,
    open(id = randomUUID(), epoch = lastLifecycle?.epoch ?? randomUUID()) {
      return open(id, epoch);
    },
    notify() {
      for (const fn of subscribers) fn();
    },
    invalidate() {
      valid = false;
      for (const fn of subscribers) fn();
    },
    activate() {
      token = {};
      valid = true;
      for (const fn of subscribers) fn();
    },
    close() {
      picker.dispose();
      dom.window.close();
    },
  };
}
const open = (id = randomUUID(), epoch = randomUUID()) => ({
  type: "kanban-project-folder-open",
  requestId: id,
  epoch,
  allowMultiple: false,
  roots: ["/tmp/home", "/work"],
});

test("only a well-formed native view request opens an accessible path dialog", async () => {
  const f = fixture();
  try {
    await f.picker.ready();
    f.message({ ...f.open(), hostId: "forged" });
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    const msg = f.open();
    f.message(msg);
    const dialog = f.win.document.querySelector("[role=dialog]");
    assert.ok(dialog);
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.ok(dialog.querySelector("input[aria-label]"));
    assert.match(dialog.textContent, /选择项目文件夹/);
    assert.match(dialog.textContent, /\/work/);
    assert.equal(f.sent.length, 0);
  } finally {
    f.close();
  }
});

test("the folder picker can receive keyboard focus while the original project modal traps focus", async () => {
  const f = fixture();
  try {
    await f.picker.ready();
    const modal = f.win.document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const titleInput = f.win.document.createElement("input");
    modal.append(titleInput);
    f.win.document.body.append(modal);
    titleInput.focus();
    // The original Radix dialog keeps focus within its own subtree.
    const enforceModal = event => {
      if (!modal.contains(event.target)) titleInput.focus();
    };
    const enforceModalFocusOut = event => {
      if (event.relatedTarget && !modal.contains(event.relatedTarget)) titleInput.focus();
    };
    f.win.document.addEventListener("focusin", enforceModal, true);
    f.win.document.addEventListener("focusout", enforceModalFocusOut, true);
    const request = f.open();
    f.message(request);
    const pickerInput = f.win.document.querySelector('[aria-label="文件夹路径"]');
    assert.ok(pickerInput);
    assert.equal(f.win.document.activeElement, pickerInput);
    pickerInput.value = "/work/project";
    assert.equal(titleInput.value, "");
    f.message({ type: "kanban-project-folder-done", requestId: request.requestId, epoch: request.epoch });
    assert.equal(f.win.document.activeElement, titleInput);
    f.win.document.removeEventListener("focusin", enforceModal, true);
    f.win.document.removeEventListener("focusout", enforceModalFocusOut, true);
  } finally { f.close(); }
});

test("removing the original modal cancels its nested folder request", async () => {
  const f = fixture();
  try {
    await f.picker.ready();
    const modal = f.win.document.createElement("div");
    modal.setAttribute("role", "dialog");
    const trigger = f.win.document.createElement("button");
    modal.append(trigger);
    f.win.document.body.append(modal);
    trigger.focus();
    const request = f.open();
    f.message(request);
    assert.ok(modal.querySelector('[aria-label="选择项目文件夹"]'));
    modal.remove();
    await new Promise(resolve => f.win.queueMicrotask(resolve));
    assert.deepEqual(f.sent, [{ type: "kanban-project-folder-reply", requestId: request.requestId, epoch: request.epoch, action: "cancel" }]);
    assert.equal(f.win.document.querySelector('[aria-label="选择项目文件夹"]'), null);
  } finally { f.close(); }
});

test("removing only the picker cancels the pending native folder request", async () => {
  const f = fixture();
  try {
    await f.picker.ready();
    const modal = f.win.document.createElement("div");
    modal.setAttribute("role", "dialog");
    const trigger = f.win.document.createElement("button");
    modal.append(trigger);
    f.win.document.body.append(modal);
    trigger.focus();
    const request = f.open();
    f.message(request);
    modal.querySelector("[data-project-folder-picker]").remove();
    await new Promise(resolve => f.win.queueMicrotask(resolve));
    assert.deepEqual(f.sent, [{ type: "kanban-project-folder-reply", requestId: request.requestId, epoch: request.epoch, action: "cancel" }]);
  } finally { f.close(); }
});

test("programmatic events cannot choose or cancel; scope revision retires the dialog", async () => {
  const f = fixture();
  try {
    await f.picker.ready();
    const msg = f.open();
    f.message(msg);
    const input = f.win.document.querySelector("input");
    input.value = "/work/project";
    f.win.document.querySelector("[data-action=select]").click();
    f.win.document.querySelector("[data-action=cancel]").click();
    assert.equal(f.sent.length, 0);
    f.notify();
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    assert.deepEqual(f.sent, [
      {
        type: "kanban-project-folder-reply",
        requestId: msg.requestId,
        epoch: msg.epoch,
        action: "cancel",
      },
    ]);
    f.message(f.open());
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    f.activate();
    await new Promise((resolve) => setImmediate(resolve));
    f.message(msg);
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    f.message(f.open());
    assert.ok(f.win.document.querySelector("[role=dialog]"));
  } finally {
    f.close();
  }
});

test("an initially inactive surface waits for its first fresh activation", async () => {
  const f = fixture(false);
  try {
    await f.picker.ready();
    const late = f.open();
    f.message(late);
    f.message(late);
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    assert.deepEqual(f.sent, [
      {
        type: "kanban-project-folder-reply",
        requestId: late.requestId,
        epoch: late.epoch,
        action: "cancel",
      },
    ]);
    f.activate();
    await new Promise((resolve) => setImmediate(resolve));
    f.message(f.open());
    assert.ok(f.win.document.querySelector("[role=dialog]"));
  } finally {
    f.close();
  }
});

test("only the exact live request accepts native invalid/done and view disposal closes it", async () => {
  const f = fixture();
  try {
    await f.picker.ready();
    const msg = f.open();
    f.message(msg);
    f.message({
      type: "kanban-project-folder-done",
      requestId: randomUUID(),
      epoch: msg.epoch,
    });
    assert.ok(f.win.document.querySelector("[role=dialog]"));
    f.message({
      type: "kanban-project-folder-invalid",
      requestId: msg.requestId,
      epoch: msg.epoch,
    });
    assert.match(
      f.win.document.querySelector("[role=alert]").textContent,
      /目录/,
    );
    f.message({
      type: "kanban-project-folder-done",
      requestId: msg.requestId,
      epoch: msg.epoch,
    });
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
    f.message(f.open());
    assert.ok(f.win.document.querySelector("[role=dialog]"));
    f.picker.dispose();
    assert.equal(f.win.document.querySelector("[role=dialog]"), null);
  } finally {
    f.close();
  }
});
