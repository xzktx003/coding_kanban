import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBrowserContextMenus } from "../src/browser-context-menu.mjs";

const enabled = process.env.CHATGPT_CONTEXT_MENU_BROWSER === "1";
const browserOnly = {
  skip:
    !enabled &&
    "Set CHATGPT_CONTEXT_MENU_BROWSER=1 for an isolated Chromium fixture",
};
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}input,button{font:16px system-ui}</style>
<input id="source" value="alpha beta gamma"><input id="other" value="other target">
<button id="trigger">open</button><div id="text">ordinary <strong>selected text</strong> tail</div><div id="rich" contenteditable="true">rich source</div>
<script type="module">
import {createBrowserContextMenus} from '/browser-context-menu.mjs';
window.createFixtureManager=createBrowserContextMenus;window.results=[];window.failures=[];window.fixtureScope='A';window.manager=createBrowserContextMenus({window,onFailure:x=>window.failures.push(x),captureScope:()=>window.fixtureScope,isScopeCurrent:scope=>scope===window.fixtureScope});
window.openFixture=(items,position={x:20,y:20})=>{window.manager.show(items,position).then(value=>window.results.push(value),e=>window.results.push({error:e.code}))};
window.disposeFixture=()=>window.manager.dispose();window.fixtureReady=true;
</script>`;
let browser, chromium;

test("rejects missing or invalid window without side effects", () => {
  assert.throws(() => createBrowserContextMenus({}), {
    code: "CONTEXT_MENU_INVALID_CONFIG",
  });
});

test("rejects oversized, ambiguous or invalid menu descriptions before rendering", async () => {
  const win = { document: { createElement() {} }, addEventListener() {} };
  assert.throws(
    () => createBrowserContextMenus({ window: win, captureScope: () => 1 }),
    { code: "CONTEXT_MENU_INVALID_CONFIG" },
  );
  const menu = createBrowserContextMenus({ window: win });
  for (const items of [
    Array.from({ length: 129 }, (_, i) => ({ id: String(i), label: "x" })),
    [
      { id: "same", label: "a" },
      { id: "same", label: "b" },
    ],
    [{ id: "a", label: "x".repeat(513) }],
    [{ id: "a", label: "x", type: "unexpected" }],
    [
      {
        id: "a",
        label: "x",
        submenu: [
          {
            id: "b",
            label: "b",
            submenu: [
              {
                id: "c",
                label: "c",
                submenu: [
                  { id: "d", label: "d", submenu: [{ id: "e", label: "e" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  ])
    await assert.rejects(menu.show(items, { x: 0, y: 0 }), {
      code: "CONTEXT_MENU_INVALID_ITEMS",
    });
  await assert.rejects(menu.show([], { x: Infinity, y: 0 }), {
    code: "CONTEXT_MENU_INVALID_POSITION",
  });
  menu.dispose();
  await assert.rejects(menu.show([], { x: 0, y: 0 }), {
    code: "CONTEXT_MENU_DISPOSED",
  });
});

if (enabled) {
  test.before(async () => {
    ({ chromium } = await import("../../../node_modules/playwright/index.mjs"));
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-background-networking",
        "--disable-features=MediaRouter,OptimizationHints",
      ],
    });
  });
  test.after(async () => {
    await browser?.close();
  });
}

async function fixture(t, options = {}) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    ...options,
  });
  t.after(() => context.close());
  const source = await readFile(
    new URL("../src/browser-context-menu.mjs", import.meta.url),
    "utf8",
  );
  const reactBundle = process.env.CHATGPT_CONTEXT_MENU_REACT_BUNDLE
    ? await readFile(process.env.CHATGPT_CONTEXT_MENU_REACT_BUNDLE, "utf8")
    : null;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["http://127.0.0.1:18080", "http://localhost:18080"].includes(url.origin)
    )
      return route.abort();
    if (url.pathname === "/browser-context-menu.mjs")
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: source,
      });
    if (url.pathname === "/react-fixture.mjs" && reactBundle)
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: reactBundle,
      });
    if (url.pathname === "/fixture")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: html,
      });
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(2000);
  await page.goto("http://127.0.0.1:18080/fixture");
  await page.waitForFunction(() => window.fixtureReady === true);
  return { page, context };
}

test(
  "mouse and keyboard preserve labels, checked state, nesting and cancellation near viewport edges",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t, {
      viewport: { width: 320, height: 240 },
    });
    await page.evaluate(() => {
      const items = [
        { id: "html", label: "<b>literal</b>" },
        { type: "separator" },
        {
          id: "parent",
          label: "Submenu",
          submenu: [
            { id: "radio", label: "Chosen", type: "radio", checked: true },
            { id: "disabled", label: "Disabled", enabled: false },
          ],
        },
      ];
      const trigger = document.querySelector("#trigger");
      trigger.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        window.openFixture(items, { x: e.clientX, y: e.clientY });
      });
    });
    await page.locator("#trigger").click({ button: "right" });
    assert.equal(
      await page.getByRole("menuitem", { name: "<b>literal</b>" }).count(),
      1,
    );
    assert.equal(await page.locator('[role="menu"] b').count(), 0);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    const radio = page.getByRole("menuitemradio", { name: "Chosen" });
    assert.equal(await radio.getAttribute("aria-checked"), "true");
    assert.equal(
      await page
        .getByRole("menuitem", { name: "Disabled" })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results), [
      { id: "radio" },
    ]);
    assert.equal(await page.locator('[role="menu"]').count(), 0);
    await page.evaluate(() =>
      window.openFixture([{ id: "one", label: "One" }], { x: 9999, y: 9999 }),
    );
    const box = await page.getByRole("menu").boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 320 &&
        box.y + box.height <= 240,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.results.length === 2);
    assert.deepEqual((await page.evaluate(() => window.results))[1], {
      id: null,
    });
  },
);

test(
  "copy uses the captured original input selection and restores source focus",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.setSelectionRange(6, 10);
      window.openFixture([{ id: "copy", label: "Copy", role: "copy" }]);
    });
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results), [
      { id: "copy" },
    ]);
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "beta",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "source",
    );
    assert.deepEqual(
      await page
        .locator("#source")
        .evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [6, 10],
    );
  },
);

test(
  "real clipboard denial produces cancellation and an explicit failure code",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions([], { origin: "http://127.0.0.1:18080" });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "copy", label: "Copy", role: "copy" }]);
    });
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results), [{ id: null }]);
    assert.equal(
      await page.evaluate(() => window.failures.at(-1)?.code),
      "CONTEXT_MENU_CLIPBOARD_DENIED",
    );
  },
);

test(
  "selectAll affects only the captured input; unsupported system roles stay disabled",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.locator("#source").focus();
    await page.evaluate(() =>
      window.openFixture([
        { id: "all", label: "Select all", role: "selectAll" },
        { id: "quit", label: "Quit", role: "quit" },
      ]),
    );
    assert.equal(
      await page
        .getByRole("menuitem", { name: /Quit/ })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.getByRole("menuitem", { name: "Select all" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results), [
      { id: "all" },
    ]);
    assert.deepEqual(
      await page
        .locator("#source")
        .evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [0, 16],
    );
    assert.equal(await page.locator("#other").inputValue(), "other target");
  },
);

test(
  "overlapping menus cancel the previous invocation; dispose removes menus and listeners",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.openFixture([{ id: "a", label: "A" }]);
      window.openFixture([{ id: "b", label: "B" }]);
    });
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(await page.getByRole("menu").count(), 1);
    await page.evaluate(() => window.disposeFixture());
    await page.waitForFunction(() => window.results.length === 2);
    assert.deepEqual(await page.evaluate(() => window.results[1]), {
      id: null,
    });
    assert.equal(await page.getByRole("menu").count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.results.length), 2);
  },
);

test(
  "touch activation and bounded, invalid input handling",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t, {
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      isMobile: true,
    });
    await page.evaluate(() =>
      window.openFixture([{ id: "touch", label: "Touch" }], { x: 500, y: 900 }),
    );
    const touchBox = await page
      .getByRole("menuitem", { name: "Touch" })
      .boundingBox();
    assert.ok(touchBox.height >= 44);
    await page.getByRole("menuitem", { name: "Touch" }).tap();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: "touch",
    });
    await page.evaluate(() =>
      window.openFixture(
        Array.from({ length: 300 }, (_, i) => ({ id: String(i), label: "x" })),
      ),
    );
    await page.waitForFunction(() => window.results.length === 2);
    assert.equal(
      await page.evaluate(() => window.results[1].error),
      "CONTEXT_MENU_INVALID_ITEMS",
    );
  },
);

test(
  "real input cut, paste, undo and redo change only the captured original target",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.setSelectionRange(6, 10);
      window.observedInput = [];
      input.addEventListener("input", (e) =>
        window.observedInput.push({ trusted: e.isTrusted, type: e.inputType }),
      );
      window.openFixture([{ id: "cut", label: "Cut", role: "cut" }]);
    });
    await page.getByRole("menuitem", { name: "Cut" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: "cut",
    });
    assert.equal(await page.locator("#source").inputValue(), "alpha  gamma");
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "beta",
    );
    assert.equal(await page.locator("#other").inputValue(), "other target");
    await page.evaluate(() =>
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]),
    );
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => window.results.length === 2);
    assert.deepEqual(await page.evaluate(() => window.results[1]), {
      id: "paste",
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    await page.evaluate(() =>
      window.openFixture([{ id: "undo", label: "Undo", role: "undo" }]),
    );
    await page.getByRole("menuitem", { name: "Undo" }).click();
    await page.waitForFunction(() => window.results.length === 3);
    assert.deepEqual(await page.evaluate(() => window.results[2]), {
      id: "undo",
    });
    assert.equal(await page.locator("#source").inputValue(), "alpha  gamma");
    await page.evaluate(() =>
      window.openFixture([{ id: "redo", label: "Redo", role: "redo" }]),
    );
    await page.getByRole("menuitem", { name: "Redo" }).click();
    await page.waitForFunction(() => window.results.length === 4);
    assert.deepEqual(await page.evaluate(() => window.results[3]), {
      id: "redo",
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    const events = await page.evaluate(() => window.observedInput);
    assert.ok(events.length >= 4 && events.every((e) => e.trusted));
  },
);

test(
  "paste denied by real clipboard permission leaves the input untouched",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
    });
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    assert.equal(
      await page.evaluate(() => window.failures.at(-1)?.code),
      "CONTEXT_MENU_CLIPBOARD_DENIED",
    );
  },
);

test(
  "a late real clipboard read cannot edit a different thread or input value",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming");
      const real = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const text = await real();
          await new Promise((resolve) => (window.releaseRead = resolve));
          return text;
        },
      });
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
    });
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      window.fixtureScope = "B";
      document.querySelector("#source").setSelectionRange(6, 10);
      window.releaseRead();
    });
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    assert.equal(await page.locator("#other").inputValue(), "other target");
    assert.deepEqual(
      await page
        .locator("#source")
        .evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [6, 10],
    );
    assert.notEqual(
      await page.evaluate(() => document.activeElement?.id),
      "source",
    );
    assert.equal(
      await page.evaluate(() => window.failures.at(-1)?.code),
      "CONTEXT_MENU_TARGET_CHANGED",
    );
  },
);

test(
  "a changed input selection during a clipboard read is not overwritten or refocused",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming");
      const real = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const items = await real();
          await new Promise((resolve) => (window.releaseRead = resolve));
          return items;
        },
      });
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.setSelectionRange(0, 5);
      window.refocuses = 0;
      input.addEventListener("focus", () => window.refocuses++);
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
    });
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(6, 10);
      window.releaseRead();
    });
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.deepEqual(
      await page
        .locator("#source")
        .evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [6, 10],
    );
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    assert.equal(await page.evaluate(() => window.refocuses), 0);
  },
);

test(
  "a focus handler changing the captured thread cannot receive the pending paste",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(() => navigator.clipboard.writeText("incoming"));
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.setSelectionRange(0, 5);
      input.addEventListener("focus", () => {
        window.fixtureScope = "B";
        input.value = "other session draft";
        input.setSelectionRange(6, 13);
      });
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
    });
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "other session draft",
    );
    assert.deepEqual(
      await page
        .locator("#source")
        .evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [6, 13],
    );
  },
);

test(
  "a focus handler changing the captured thread cannot receive selectAll",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.setSelectionRange(0, 5);
      input.addEventListener("focus", () => {
        window.fixtureScope = "B";
        input.value = "other session draft";
        input.setSelectionRange(6, 13);
      });
      window.openFixture([
        { id: "all", label: "Select all", role: "selectAll" },
      ]);
    });
    await page.getByRole("menuitem", { name: "Select all" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "other session draft",
    );
    assert.deepEqual(
      await page
        .locator("#source")
        .evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [6, 13],
    );
  },
);

test(
  "a non-native action cannot return its id after the captured thread changes",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "archive", label: "Archive" }]);
      window.fixtureScope = "B";
    });
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "");
  },
);

test(
  "a non-native action is cancelled if focus restoration changes the thread",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.setSelectionRange(0, 5);
      input.addEventListener("focus", () => {
        window.fixtureScope = "B";
      });
      window.openFixture([{ id: "archive", label: "Archive" }]);
    });
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.equal(await page.evaluate(() => window.fixtureScope), "B");
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
  },
);

test(
  "all native roles stay disabled without a verifiable thread scope",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.manager.dispose();
      window.manager = window.createFixtureManager({
        window,
        onFailure: (x) => window.failures.push(x),
      });
      window.openFixture([
        { id: "copy", label: "Copy", role: "copy" },
        { id: "all", label: "Select all", role: "selectAll" },
        { id: "cut", label: "Cut", role: "cut" },
        { id: "paste", label: "Paste", role: "paste" },
      ]);
    });
    for (const label of ["Copy", "Select all", "Cut", "Paste"]) {
      const item = page.getByRole("menuitem", { name: new RegExp(label) });
      assert.equal(await item.getAttribute("aria-disabled"), "true");
      assert.match(await item.getAttribute("title"), /会话/);
    }
  },
);

test(
  "controlled React input receives real edit events and retains undo/redo state",
  {
    skip:
      (!enabled || !process.env.CHATGPT_CONTEXT_MENU_REACT_BUNDLE) &&
      "Set browser mode and an explicit private React fixture bundle",
  },
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(() => import("/react-fixture.mjs"));
    const target = page.locator("#react-controlled");
    await target.waitFor();
    await target.focus();
    await page.evaluate(() => {
      document.querySelector("#react-controlled").setSelectionRange(6, 10);
      window.openFixture([{ id: "cut", label: "Cut", role: "cut" }]);
    });
    await page.getByRole("menuitem", { name: "Cut" }).click();
    await page.waitForFunction(
      () =>
        window.results.length === 1 &&
        window.reactFixtureValue === "alpha  gamma",
    );
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: "cut",
    });
    assert.equal(
      await page.evaluate(() => window.reactFixtureInputTrusted),
      true,
    );
    await page.evaluate(() =>
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]),
    );
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(
      () =>
        window.results.length === 2 &&
        window.reactFixtureValue === "alpha beta gamma",
    );
    assert.deepEqual(await page.evaluate(() => window.results[1]), {
      id: "paste",
    });
    await page.evaluate(() =>
      window.openFixture([{ id: "undo", label: "Undo", role: "undo" }]),
    );
    await page.getByRole("menuitem", { name: "Undo" }).click();
    await page.waitForFunction(
      () =>
        window.results.length === 3 &&
        window.reactFixtureValue === "alpha  gamma",
    );
    await page.evaluate(() =>
      window.openFixture([{ id: "redo", label: "Redo", role: "redo" }]),
    );
    await page.getByRole("menuitem", { name: "Redo" }).click();
    await page.waitForFunction(
      () =>
        window.results.length === 4 &&
        window.reactFixtureValue === "alpha beta gamma",
    );
    assert.deepEqual(
      await page.evaluate(() => window.results.map((x) => x.id)),
      ["cut", "paste", "undo", "redo"],
    );
  },
);

test(
  "copy of a document selection retains the exact original text",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#text strong"));
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.openFixture([{ id: "copy", label: "Copy", role: "copy" }]);
    });
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: "copy",
    });
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "selected text",
    );
  },
);

for (const mode of ["focus-only", "transient-class"])
  test(
    `captured ProseMirror ${mode} blur keeps only the safe menu open`,
    browserOnly,
    async (t) => {
      const { page } = await fixture(t);
      await page.evaluate((mode) => {
        const editor = document.querySelector("#rich");
        editor.className = "ProseMirror ProseMirror-focused";
        editor.addEventListener("blur", () => {
          editor.classList.remove("ProseMirror-focused");
          if (mode === "transient-class") {
            editor.classList.add("hidden-owner");
            editor.classList.remove("hidden-owner");
          }
        });
        editor.addEventListener("focus", () =>
          editor.classList.add("ProseMirror-focused"),
        );
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        window.openFixture([{ id: "plain", label: "Plain action" }]);
      }, mode);
      if (mode === "focus-only") {
        await page.waitForTimeout(50);
        assert.equal(await page.getByRole("menu").count(), 1);
        await page.getByRole("menuitem", { name: "Plain action" }).click();
        await page.waitForFunction(() => window.results.length === 1);
        assert.deepEqual(await page.evaluate(() => window.results[0]), {
          id: "plain",
        });
      } else {
        await page.waitForFunction(() => window.results.length === 1);
        assert.deepEqual(await page.evaluate(() => window.results[0]), {
          id: null,
        });
        assert.equal(await page.getByRole("menu").count(), 0);
      }
    },
  );

test(
  "a changed document selection cannot copy a stale captured range",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("clipboard unchanged");
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#text strong"));
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.openFixture([{ id: "copy", label: "Copy", role: "copy" }]);
    });
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#text").firstChild);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "clipboard unchanged",
    );
  },
);

test(
  "disposing during a late clipboard read prevents any edit or retry",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming");
      const real = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const text = await real();
          await new Promise((resolve) => (window.releaseRead = resolve));
          return text;
        },
      });
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
    });
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      window.disposeFixture();
      window.releaseRead();
    });
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    assert.equal(await page.getByRole("menu").count(), 0);
  },
);

test(
  "scrolling a long menu keeps it open and lets the user activate a later item",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t, {
      viewport: { width: 320, height: 240 },
    });
    await page.evaluate(() =>
      window.openFixture(
        Array.from({ length: 30 }, (_, i) => ({
          id: String(i),
          label: `Item ${i}`,
        })),
      ),
    );
    const menu = page.getByRole("menu");
    await menu.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole("menu").count(), 1);
    await page.getByRole("menuitem", { name: "Item 29", exact: true }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: "29",
    });
  },
);

test(
  "rich editor write roles explicitly explain their current unsupported boundary",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.locator("#rich").focus();
    await page.evaluate(() => {
      const node = document.querySelector("#rich").firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 4);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.openFixture([
        { id: "copy", label: "Copy", role: "copy" },
        { id: "cut", label: "Cut", role: "cut" },
        { id: "paste", label: "Paste", role: "paste" },
        { id: "undo", label: "Undo", role: "undo" },
      ]);
    });
    assert.equal(
      await page
        .getByRole("menuitem", { name: "Copy" })
        .getAttribute("aria-disabled"),
      "false",
    );
    for (const label of ["Cut", "Paste", "Undo"]) {
      const item = page.getByRole("menuitem", { name: new RegExp(label) });
      assert.equal(await item.getAttribute("aria-disabled"), "true");
      assert.match(await item.getAttribute("title"), /不支持/);
    }
  },
);

test(
  "cut denied by real clipboard permission does not delete the selection",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions([], { origin: "http://127.0.0.1:18080" });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(6, 10);
      window.openFixture([{ id: "cut", label: "Cut", role: "cut" }]);
    });
    await page.getByRole("menuitem", { name: "Cut" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    assert.equal(
      await page.evaluate(() => window.failures.at(-1)?.code),
      "CONTEXT_MENU_CLIPBOARD_DENIED",
    );
  },
);

test(
  "a late clipboard read cannot overwrite changed input content",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming");
      const real = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const text = await real();
          await new Promise((resolve) => (window.releaseRead = resolve));
          return text;
        },
      });
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
    });
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      document.querySelector("#source").value = "changed by owner";
      window.releaseRead();
    });
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "changed by owner",
    );
    assert.equal(
      await page.evaluate(() => window.failures.at(-1)?.code),
      "CONTEXT_MENU_TARGET_CHANGED",
    );
  },
);

test(
  "an intercepted edit reports an uncertain outcome instead of success",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.setSelectionRange(6, 10);
      input.addEventListener(
        "input",
        () => {
          input.value = "owner modified the result";
        },
        { once: true },
      );
      window.openFixture([{ id: "cut", label: "Cut", role: "cut" }]);
    });
    await page.getByRole("menuitem", { name: "Cut" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "owner modified the result",
    );
    assert.equal(
      await page.evaluate(() => window.failures.at(-1)?.code),
      "CONTEXT_MENU_OUTCOME_UNCERTAIN",
    );
  },
);

test(
  "oversized input and fragmented selection stay unavailable before copying a snapshot",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.locator("#source").focus();
    await page.evaluate(() => {
      const input = document.querySelector("#source");
      input.value = "x".repeat(1024 * 1024 + 1);
      input.setSelectionRange(0, 2);
      window.openFixture([{ id: "copy", label: "Copy", role: "copy" }]);
    });
    assert.equal(
      await page
        .getByRole("menuitem", { name: /Copy/ })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.querySelector("#trigger").focus();
      const target = document.querySelector("#text");
      target.replaceChildren();
      for (let index = 0; index < 4100; index++) {
        const span = document.createElement("span");
        span.textContent = "x";
        target.appendChild(span);
      }
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.openFixture([{ id: "copy", label: "Copy", role: "copy" }]);
    });
    assert.equal(
      await page
        .getByRole("menuitem", { name: /Copy/ })
        .getAttribute("aria-disabled"),
      "true",
    );
  },
);

test(
  "oversized real clipboard text is rejected without editing the target",
  browserOnly,
  async (t) => {
    const { page, context } = await fixture(t);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await page.evaluate(() =>
      navigator.clipboard.writeText("x".repeat(1024 * 1024 + 1)),
    );
    await page.locator("#source").focus();
    await page.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
    });
    await page.getByRole("menuitem", { name: "Paste" }).click();
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results[0]), {
      id: null,
    });
    assert.equal(
      await page.locator("#source").inputValue(),
      "alpha beta gamma",
    );
    assert.equal(
      await page.evaluate(() => window.failures.at(-1)?.code),
      "CONTEXT_MENU_CLIPBOARD_LIMIT",
    );
  },
);

async function embeddedFixture(t, origin = "http://127.0.0.1:18080") {
  const { page, context } = await fixture(t);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  await page.evaluate((src) => {
    const shell = document.createElement("section");
    shell.id = "mode-shell";
    const iframe = document.createElement("iframe");
    iframe.id = "child";
    iframe.src = src;
    shell.appendChild(iframe);
    document.body.appendChild(shell);
  }, `${origin}/fixture`);
  const element = await page.locator("#child").elementHandle();
  const frame = await element.contentFrame();
  await frame.waitForFunction(() => window.fixtureReady === true);
  return { page, context, frame };
}

for (const mode of ["visibility", "opacity", "transient"])
  test(
    `child input ${mode} change cancels pending paste without editing or refocusing`,
    browserOnly,
    async (t) => {
      const { page, context } = await fixture(t);
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: "http://127.0.0.1:18080",
      });
      await page.evaluate(async () => {
        const input = document.querySelector("#source");
        const wrapper = document.createElement("div");
        wrapper.id = "source-wrapper";
        input.before(wrapper);
        wrapper.appendChild(input);
        await navigator.clipboard.writeText("incoming");
        const real = navigator.clipboard.read.bind(navigator.clipboard);
        Object.defineProperty(navigator.clipboard, "read", {
          value: async () => {
            const items = await real();
            await new Promise((resolve) => (window.releaseRead = resolve));
            return items;
          },
        });
      });
      await page.locator("#source").focus();
      await page.evaluate(() => {
        const input = document.querySelector("#source");
        input.setSelectionRange(0, 5);
        window.refocuses = 0;
        input.addEventListener("focus", () => window.refocuses++);
        window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
      });
      await page.getByRole("menuitem", { name: "Paste" }).click();
      await page.waitForFunction(
        () => typeof window.releaseRead === "function",
      );
      await page.evaluate((mode) => {
        const wrapper = document.querySelector("#source-wrapper");
        if (mode === "visibility") wrapper.style.visibility = "hidden";
        else if (mode === "opacity") wrapper.style.opacity = "0";
        else {
          wrapper.style.visibility = "hidden";
          wrapper.style.visibility = "";
        }
        window.releaseRead();
      }, mode);
      await page.waitForFunction(() => window.results.length === 1);
      assert.deepEqual(await page.evaluate(() => window.results[0]), {
        id: null,
      });
      assert.equal(
        await page.locator("#source").inputValue(),
        "alpha beta gamma",
      );
      assert.equal(await page.evaluate(() => window.refocuses), 0);
    },
  );

for (const mode of ["hidden", "inert", "transient"])
  test(
    `parent ${mode} cancels a pending iframe paste without editing or refocusing`,
    browserOnly,
    async (t) => {
      const { page, frame } = await embeddedFixture(t);
      await frame.locator("#source").focus();
      await frame.evaluate(async () => {
        await navigator.clipboard.writeText("incoming");
        const real = navigator.clipboard.read.bind(navigator.clipboard);
        Object.defineProperty(navigator.clipboard, "read", {
          value: async () => {
            const items = await real();
            await new Promise((resolve) => (window.releaseRead = resolve));
            return items;
          },
        });
      });
      await frame.locator("#source").focus();
      await frame.evaluate(() => {
        const input = document.querySelector("#source");
        input.setSelectionRange(0, 5);
        window.refocuses = 0;
        input.addEventListener("focus", () => window.refocuses++);
        window.openFixture([{ id: "paste", label: "Paste", role: "paste" }]);
      });
      await frame.getByRole("menuitem", { name: "Paste" }).click();
      await frame.waitForFunction(
        () => typeof window.releaseRead === "function",
      );
      await page.evaluate((mode) => {
        const shell = document.querySelector("#mode-shell");
        if (mode === "hidden") shell.hidden = true;
        else if (mode === "inert") shell.inert = true;
        else {
          shell.hidden = true;
          shell.inert = true;
          shell.hidden = false;
          shell.inert = false;
        }
      }, mode);
      await frame.evaluate(() => window.releaseRead());
      await frame.waitForFunction(() => window.results.length === 1);
      assert.deepEqual(await frame.evaluate(() => window.results[0]), {
        id: null,
      });
      assert.equal(
        await frame.locator("#source").inputValue(),
        "alpha beta gamma",
      );
      assert.equal(await frame.evaluate(() => window.refocuses), 0);
    },
  );

test(
  "cross-origin iframe cannot authorize menu operations from an unverifiable parent",
  browserOnly,
  async (t) => {
    const { frame } = await embeddedFixture(t, "http://localhost:18080");
    await frame.locator("#source").focus();
    await frame.evaluate(() => {
      document.querySelector("#source").setSelectionRange(0, 5);
      window.openFixture([{ id: "copy", label: "Copy", role: "copy" }]);
    });
    await frame.waitForFunction(() => window.results.length === 1);
    assert.equal(
      await frame.evaluate(() => window.results[0].error),
      "CONTEXT_MENU_CONTEXT_UNVERIFIED",
    );
    assert.equal(await frame.getByRole("menu").count(), 0);
  },
);
