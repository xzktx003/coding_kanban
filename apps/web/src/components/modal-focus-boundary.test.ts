import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};
import { activateModalFocusBoundary } from "./modal-focus-boundary.js";

test("modal focuses initial field, contains Tab/focus, and restores its opener", () => {
  const dom = new JSDOM(
    '<button id="opener">Open</button><div id="dialog" tabindex="-1"><input id="name"><button id="close">Close</button><button hidden>Hidden</button><button disabled>Disabled</button></div>',
  );
  const doc = dom.window.document;
  const opener = doc.querySelector<HTMLButtonElement>("#opener")!;
  const dialog = doc.querySelector<HTMLDivElement>("#dialog")!;
  const name = doc.querySelector<HTMLInputElement>("#name")!;
  const close = doc.querySelector<HTMLButtonElement>("#close")!;
  opener.focus();
  const cleanup = activateModalFocusBoundary(dialog, name);
  assert.equal(doc.activeElement, name);
  name.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(doc.activeElement, close);
  close.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(doc.activeElement, name);
  opener.focus();
  assert.equal(doc.activeElement, name);
  cleanup();
  assert.equal(doc.activeElement, opener);
});

test("empty modal is focusable and unmounted opener is not restored", () => {
  const dom = new JSDOM(
    '<button id="opener">Open</button><div id="dialog" tabindex="-1"></div>',
  );
  const doc = dom.window.document;
  const opener = doc.querySelector<HTMLButtonElement>("#opener")!;
  const dialog = doc.querySelector<HTMLDivElement>("#dialog")!;
  opener.focus();
  const cleanup = activateModalFocusBoundary(dialog);
  assert.equal(doc.activeElement, dialog);
  opener.remove();
  assert.doesNotThrow(cleanup);
});
