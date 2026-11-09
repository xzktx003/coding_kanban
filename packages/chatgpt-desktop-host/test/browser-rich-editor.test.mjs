import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openWebviewArchive } from "../src/assets.mjs";
import { createBrowserRichEditor } from "../src/browser-rich-editor.mjs";

const enabled = process.env.CHATGPT_RICH_EDITOR_BROWSER === "1";
const originalAsar = process.env.CHATGPT_RICH_EDITOR_ORIGINAL_ASAR;
const browserOnly = {
  skip:
    !(enabled && originalAsar) &&
    "Set CHATGPT_RICH_EDITOR_BROWSER=1 and CHATGPT_RICH_EDITOR_ORIGINAL_ASAR to the pinned Mac ASAR",
};
let browser, assets;

const fixtureHtml = `<!doctype html><meta charset="utf-8"><div id="source"></div><div id="native"></div><div id="target"></div><div id="buttons"></div><script type="module">
import * as original from '/assets/app-initial-18b189e867e7.js';
import * as shared from '/assets/app-shared-601019a330d7.js';
import {createBrowserRichEditor} from '/adapter.mjs';
import {createBrowserContextMenus} from '/context-menu.mjs';
original.Oc(); shared.zEt();
const options={enableCodeBlocks:true,enableRichText:true,enableSelectedTextLinks:true};
const owners=Object.fromEntries(['source','native','target'].map(name=>{const controller=original.Cc(null,options);document.getElementById(name).append(controller.view.dom);return [name,controller]}));
let active='source', token=Object.freeze({revision:1}), revision=1, action=null, useAllSelection=true;
let composerSha256='244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032';
const results=[], failures=[];
const adapter=createBrowserRichEditor({window,getCommittedEditor:()=>({controller:owners[active],view:owners[active].view,composerSha256,sharedSha256:'02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116',allSelectionConstructor:useAllSelection?shared.AEt:undefined}),captureScope:()=>token,isScopeCurrent:value=>value===token,onFailure:value=>failures.push(value)});
const fixture={owners,shared,results,failures,adapter,
 openRichMenu(roles=['cut']){const menus=createBrowserContextMenus({window,richEditor:adapter,captureScope:()=>token,isScopeCurrent:value=>value===token,onFailure:value=>failures.push(value)});this.menus=menus;menus.show(roles.map(role=>({id:role,label:role,role})),{x:20,y:20}).then(result=>results.push({menu:true,...result}));},
 select(name){active=name;token=Object.freeze({revision:++revision});const view=owners[name].view;view.focus();},
 renew(){token=Object.freeze({revision:++revision});},
 wrongVersion(){composerSha256='0'.repeat(64);}, disableAllSelection(){useAllSelection=false;},
 capture(){action=adapter.capture();return action!==null;},
 synthetic(role){return action.execute(role,new MouseEvent('click'));},
 seed(){const view=owners.source.view,s=view.state.schema;
  const image=s.nodes.chatGptReferenceImageMention.create({referenceImageId:'fixture-image-id',title:'fixture image',assetPointer:'fixture://image',thumbnailAssetPointer:null,start:0,end:0});
  const doc=s.nodes.doc.create(null,[s.nodes.paragraph.create(null,[s.text('alpha ',[s.marks.strong.create()]),s.text('example',[s.marks.link.create({href:'https://example.invalid/',title:null})]),s.text(' '),image,s.text(' omega',[s.marks.em.create()])])]);
  view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content).setMeta('addToHistory',false));
 },
 selectSource(){this.select('source');const view=owners.source.view;view.dispatch(view.state.tr.setSelection(shared.LEt.create(view.state.doc,1,view.state.doc.content.size-1)));},
 doc(name){return owners[name].view.state.doc.toJSON();},
};
for(const role of ['copy','cut','paste','undo','redo']){const button=document.createElement('button');button.textContent=role;button.addEventListener('click',event=>{action.execute(role,event).then(result=>results.push({role,...result}));});document.getElementById('buttons').append(button);}
window.fixture=fixture;window.fixtureReady=true;
</script>`;

if (enabled && originalAsar) {
  test.before(async () => {
    const archive = await openWebviewArchive({
      asarPath: originalAsar,
      sha256:
        "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
    });
    assets = new Map();
    try {
      for (const [name, sha] of [
        [
          "app-initial-18b189e867e7.js",
          "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032",
        ],
        [
          "app-shared-601019a330d7.js",
          "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116",
        ],
        [
          "rolldown-runtime-428824ca0286.js",
          "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e",
        ],
      ]) {
        const asset = await archive.acquireAsset(`webview/assets/${name}`);
        try {
          assert.equal(
            createHash("sha256").update(asset.body).digest("hex"),
            sha,
          );
          assets.set(name, Buffer.from(asset.body));
        } finally {
          asset.release();
        }
      }
    } finally {
      await archive.close();
    }
    const { chromium } =
      await import("../../../node_modules/playwright/index.mjs");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-background-networking"],
    });
  });
  test.after(async () => browser?.close());
}

async function fixture(t) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:18080",
  });
  const adapter = await readFile(
    new URL("../src/browser-rich-editor.mjs", import.meta.url),
  );
  const contextMenu = await readFile(
    new URL("../src/browser-context-menu.mjs", import.meta.url),
  );
  await context.route("**/*", (route) => {
    const pathname = new URL(route.request().url()).pathname,
      name = pathname.split("/").at(-1);
    if (assets.has(name))
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: assets.get(name),
      });
    if (pathname === "/context-menu.mjs")
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: contextMenu,
      });
    if (pathname === "/adapter.mjs")
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: adapter,
      });
    if (pathname === "/fixture")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: fixtureHtml,
      });
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  await page.goto("http://127.0.0.1:18080/fixture");
  await page.waitForFunction(() => window.fixtureReady === true);
  return { page, context };
}
async function clickAction(page, role) {
  assert.equal(await page.evaluate(() => window.fixture.capture()), true);
  const previous = await page.evaluate(() => window.fixture.results.length);
  await page.getByRole("button", { name: role, exact: true }).click();
  await page.waitForFunction(
    (count) => window.fixture.results.length > count,
    previous,
  );
  return page.evaluate(() => window.fixture.results.at(-1));
}

test("requires an explicit committed editor and scope authority", () => {
  assert.throws(() => createBrowserRichEditor({}), {
    code: "RICH_EDITOR_INVALID_CONFIG",
  });
});

test(
  "original composer cut, undo, redo and rich paste match native keyboard including image references",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.fixture.seed();
      window.fixture.selectSource();
    });
    assert.equal((await clickAction(page, "cut")).status, "applied");
    const copied = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0];
      return {
        types: item.types,
        html: await (await item.getType("text/html")).text(),
      };
    });
    assert.ok(
      copied.types.includes("text/plain") && copied.types.includes("text/html"),
    );
    assert.ok(
      copied.html.includes("chatgpt-reference-image://fixture-image-id"),
    );
    const cut = await page.evaluate(() => window.fixture.doc("source"));
    assert.equal(JSON.stringify(cut).includes("fixture-image-id"), false);
    assert.equal((await clickAction(page, "undo")).status, "applied");
    assert.equal(
      JSON.stringify(
        await page.evaluate(() => window.fixture.doc("source")),
      ).includes("fixture-image-id"),
      true,
    );
    assert.equal((await clickAction(page, "redo")).status, "applied");
    await page.evaluate(() => window.fixture.select("native"));
    await page.keyboard.press("Control+v");
    const native = await page.evaluate(() => window.fixture.doc("native"));
    await page.evaluate(() => window.fixture.select("target"));
    assert.equal((await clickAction(page, "paste")).status, "applied");
    const adapted = await page.evaluate(() => window.fixture.doc("target"));
    assert.deepEqual(adapted, native);
    assert.ok(JSON.stringify(adapted).includes("fixture-image-id"));
    assert.ok(JSON.stringify(adapted).includes('"strong"'));
    assert.ok(JSON.stringify(adapted).includes('"link"'));
    assert.ok(JSON.stringify(adapted).includes('"em"'));
  },
);

test(
  "late clipboard read after same-value scope revision cannot edit or refocus the new owner",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming");
      const read = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const result = await read();
          await new Promise((resolve) => (window.releaseRead = resolve));
          return result;
        },
      });
      window.fixture.select("source");
      window.fixture.capture();
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    await page.getByRole("button", { name: "paste", exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      window.fixture.renew();
      window.releaseRead();
    });
    await page.waitForFunction(() => window.fixture.results.length === 1);
    assert.equal(
      (await page.evaluate(() => window.fixture.results[0])).status,
      "stale",
    );
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "each original paste transaction rechecks scope before dispatch and restores the original method",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming ordinary");
      window.fixture.select("source");
      const v = window.fixture.owners.source.view,
        base = v.dispatch;
      window.dispatches = 0;
      window.originalDispatch = function (tr) {
        window.dispatches++;
        base(tr);
        window.fixture.renew();
      };
      v.dispatch = window.originalDispatch;
      window.fixture.capture();
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    await page.getByRole("button", { name: "paste", exact: true }).click();
    await page.waitForFunction(() => window.fixture.results.length === 1);
    assert.equal(
      (await page.evaluate(() => window.fixture.results[0])).status,
      "uncertain",
    );
    assert.equal(await page.evaluate(() => window.dispatches), 1);
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.owners.source.view.dispatch ===
          window.originalDispatch,
      ),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "untrusted synthetic action and clipboard image binary are explicitly rejected",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.fixture.select("source");
      window.fixture.capture();
    });
    assert.equal(
      (await page.evaluate(() => window.fixture.synthetic("paste"))).status,
      "unavailable",
    );
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      canvas.getContext("2d").fillRect(0, 0, 1, 1);
      const image = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": image }),
      ]);
      window.fixture.select("source");
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    const result = await clickAction(page, "paste");
    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "RICH_CLIPBOARD_FORMAT_UNSUPPORTED");
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "unknown original composer digest does not create a capture",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.fixture.select("source");
      window.fixture.wrongVersion();
    });
    assert.equal(await page.evaluate(() => window.fixture.capture()), false);
  },
);

test(
  "real original paste listeners are not called without a proven async scope guard",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob(["ordinary incoming"], { type: "text/plain" }),
          "text/html": new Blob(["<p>ordinary incoming</p>"], {
            type: "text/html",
          }),
        }),
      ]);
      window.fixture.select("source");
      window.calls = 0;
      window.fixture.owners.source.eventEmitter.addListener(
        "pasted-link",
        () => {
          window.calls++;
          return true;
        },
      );
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    const result = await clickAction(page, "paste");
    assert.equal(result.status, "uncertain");
    assert.equal(result.code, "RICH_OUTCOME_UNCERTAIN");
    assert.equal(await page.evaluate(() => window.calls), 0);
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "a paste listener registered during the first transaction never receives the clipboard",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("ordinary incoming");
      window.fixture.select("source");
      const controller = window.fixture.owners.source,
        v = controller.view,
        base = v.dispatch;
      window.calls = 0;
      window.dispatches = 0;
      window.originalDispatch = function (tr) {
        window.dispatches++;
        base(tr);
        controller.eventEmitter.addListener("pasted-link", () => {
          window.calls++;
          return true;
        });
      };
      v.dispatch = window.originalDispatch;
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    const result = await clickAction(page, "paste");
    assert.equal(result.status, "uncertain");
    assert.equal(await page.evaluate(() => window.dispatches), 1);
    assert.equal(await page.evaluate(() => window.calls), 0);
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "unrelated original image file and large-text listeners do not block an ordinary text paste",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("ordinary incoming");
      window.calls = 0;
      for (const name of ["source", "native"]) {
        const controller = window.fixture.owners[name];
        controller.addPastedImagesHandler(() => {
          window.calls++;
        });
        controller.addPastedFilesHandler(() => {
          window.calls++;
        });
        controller.addPastedTextHandler(() => {
          window.calls++;
        });
      }
      window.fixture.select("native");
    });
    await page.keyboard.press("Control+v");
    const native = await page.evaluate(() => window.fixture.doc("native"));
    await page.evaluate(() => window.fixture.select("source"));
    const result = await clickAction(page, "paste");
    assert.equal(result.status, "applied");
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      native,
    );
    assert.equal(await page.evaluate(() => window.calls), 0);
  },
);

test(
  "an actually emitted original large-text listener is stopped before it receives clipboard text",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("x".repeat(6000));
      window.fixture.select("source");
      window.calls = 0;
      window.fixture.owners.source.addPastedTextHandler(() => {
        window.calls++;
      });
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    const result = await clickAction(page, "paste");
    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "RICH_PASTE_LISTENER_UNSUPPORTED");
    assert.equal(await page.evaluate(() => window.calls), 0);
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "a clipboard listener added during the async read aborts before a transaction",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("ordinary incoming");
      const read = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const result = await read();
          await new Promise((resolve) => {
            window.releaseRead = resolve;
          });
          return result;
        },
      });
      window.fixture.select("source");
      window.fixture.capture();
      window.calls = 0;
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    await page.getByRole("button", { name: "paste", exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      window.fixture.owners.source.addPastedImagesHandler(() => {
        window.calls++;
      });
      window.releaseRead();
    });
    await page.waitForFunction(() => window.fixture.results.length === 1);
    const result = await page.evaluate(() => window.fixture.results[0]);
    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "RICH_PASTE_LISTENER_UNSUPPORTED");
    assert.equal(await page.evaluate(() => window.calls), 0);
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "actual context menu applies rich cut and undo through trusted original composer transactions",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.fixture.seed();
      window.fixture.selectSource();
      window.fixture.openRichMenu(["cut"]);
    });
    const cut = page.getByRole("menuitem", { name: "cut", exact: true });
    await cut.click();
    await page.waitForFunction(() =>
      window.fixture.results.some((result) => result.menu),
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixture.results.find((result) => result.menu),
      ),
      { menu: true, id: "cut" },
      JSON.stringify(
        await page.evaluate(() => ({
          failures: window.fixture.failures,
          hasImage: JSON.stringify(window.fixture.doc("source")).includes(
            "fixture-image-id",
          ),
        })),
      ),
    );
    assert.equal(
      JSON.stringify(
        await page.evaluate(() => window.fixture.doc("source")),
      ).includes("fixture-image-id"),
      false,
    );
    await page.evaluate(() => {
      window.fixture.select("source");
      window.fixture.openRichMenu(["undo"]);
    });
    await page.getByRole("menuitem", { name: "undo", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => window.fixture.results.filter((result) => result.menu).length === 2,
    );
    assert.deepEqual(
      await page.evaluate(
        () => window.fixture.results.filter((result) => result.menu)[1],
      ),
      { menu: true, id: "undo" },
    );
    assert.equal(
      JSON.stringify(
        await page.evaluate(() => window.fixture.doc("source")),
      ).includes("fixture-image-id"),
      true,
    );
    await page.evaluate(() => {
      window.fixture.select("source");
      window.fixture.openRichMenu(["redo"]);
    });
    await page.getByRole("menuitem", { name: "redo", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => window.fixture.results.filter((result) => result.menu).length === 3,
    );
    assert.deepEqual(
      await page.evaluate(
        () => window.fixture.results.filter((result) => result.menu)[2],
      ),
      { menu: true, id: "redo" },
    );
    assert.equal(
      JSON.stringify(
        await page.evaluate(() => window.fixture.doc("source")),
      ).includes("fixture-image-id"),
      false,
    );
  },
);

test(
  "closing a real rich menu during delayed clipboard read cancels its captured action",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming");
      const read = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const result = await read();
          await new Promise((resolve) => (window.releaseRead = resolve));
          return result;
        },
      });
      window.fixture.select("source");
      window.fixture.openRichMenu(["paste"]);
    });
    const before = await page.evaluate(() => window.fixture.doc("source"));
    await page.getByRole("menuitem", { name: "paste", exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      window.fixture.menus.dispose();
      window.releaseRead();
    });
    await page.waitForFunction(() =>
      window.fixture.results.some((result) => result.menu),
    );
    await page.waitForTimeout(100);
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixture.results.find((result) => result.menu),
      ),
      { menu: true, id: null },
    );
    assert.deepEqual(
      await page.evaluate(() => window.fixture.doc("source")),
      before,
    );
  },
);

test(
  "rich context menu copy and paste match original keyboard paste including formatted image references",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.fixture.seed();
      window.fixture.selectSource();
      window.fixture.openRichMenu(["copy"]);
    });
    await page.getByRole("menuitem", { name: "copy", exact: true }).click();
    await page.waitForFunction(
      () => window.fixture.results.filter((x) => x.menu).length === 1,
    );
    assert.deepEqual(
      await page.evaluate(() => window.fixture.results.find((x) => x.menu)),
      { menu: true, id: "copy" },
    );
    await page.evaluate(() => window.fixture.select("native"));
    await page.keyboard.press("Control+v");
    const native = await page.evaluate(() => window.fixture.doc("native"));
    await page.evaluate(() => {
      window.fixture.select("target");
      const c = window.fixture.owners.target;
      c.addPastedImagesHandler(() => {});
      c.addPastedFilesHandler(() => {});
      window.fixture.openRichMenu(["paste"]);
    });
    await page.getByRole("menuitem", { name: "paste", exact: true }).click();
    await page.waitForFunction(
      () => window.fixture.results.filter((x) => x.menu).length === 2,
    );
    assert.deepEqual(
      await page.evaluate(
        () => window.fixture.results.filter((x) => x.menu)[1],
      ),
      { menu: true, id: "paste" },
    );
    const actual = await page.evaluate(() => window.fixture.doc("target"));
    assert.deepEqual(actual, native);
    assert.ok(JSON.stringify(actual).includes("fixture-image-id"));
    assert.ok(JSON.stringify(actual).includes('"strong"'));
  },
);

test(
  "rich capability is not offered when a different editable owns focus",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      const other = document.createElement("div");
      other.id = "foreign";
      other.contentEditable = "true";
      other.textContent = "foreign";
      document.body.append(other);
      other.focus();
      window.fixture.openRichMenu(["undo"]);
    });
    assert.equal(
      await page.getByRole("menuitem", { name: /undo/ }).isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.deepEqual(
      await page.evaluate(() => window.fixture.results.find((x) => x.menu)),
      { menu: true, id: null },
    );
  },
);

test(
  "a rich menu paste whose originating scope changes while reading cannot edit either owner",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("incoming");
      const read = navigator.clipboard.read.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "read", {
        value: async () => {
          const result = await read();
          await new Promise((resolve) => (window.releaseRead = resolve));
          return result;
        },
      });
      window.fixture.select("source");
      window.fixture.openRichMenu(["paste"]);
    });
    const before = await page.evaluate(() => [
      window.fixture.doc("source"),
      window.fixture.doc("target"),
    ]);
    await page.getByRole("menuitem", { name: "paste", exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseRead === "function");
    await page.evaluate(() => {
      window.fixture.select("target");
      window.releaseRead();
    });
    await page.waitForFunction(() =>
      window.fixture.results.some((result) => result.menu),
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixture.results.find((result) => result.menu),
      ),
      { menu: true, id: null },
    );
    assert.deepEqual(
      await page.evaluate(() => [
        window.fixture.doc("source"),
        window.fixture.doc("target"),
      ]),
      before,
    );
  },
);

test(
  "rich context menu selectAll uses original ProseMirror selection matching trusted Ctrl+A",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.fixture.seed();
      window.fixture.select("source");
    });
    await page.keyboard.press("Control+a");
    const expected = await page.evaluate(() => {
      const v = window.fixture.owners.source.view,
        s = v.state.selection;
      return {
        json: s.toJSON(),
        from: s.from,
        to: s.to,
        docSize: v.state.doc.content.size,
      };
    });
    await page.evaluate(() => {
      const v = window.fixture.owners.source.view;
      v.dispatch(
        v.state.tr.setSelection(
          window.fixture.shared.LEt.create(v.state.doc, 2),
        ),
      );
      v.focus();
      window.fixture.openRichMenu(["selectAll"]);
    });
    const action = page.getByRole("menuitem", {
      name: "selectAll",
      exact: true,
    });
    await action.click();
    await page.waitForFunction(() =>
      window.fixture.results.some((x) => x.menu),
    );
    assert.deepEqual(
      await page.evaluate(() => window.fixture.results.find((x) => x.menu)),
      { menu: true, id: "selectAll" },
    );
    const actual = await page.evaluate(() => {
      const v = window.fixture.owners.source.view,
        s = v.state.selection;
      return {
        json: s.toJSON(),
        from: s.from,
        to: s.to,
        docSize: v.state.doc.content.size,
      };
    });
    assert.deepEqual(actual, expected);
    assert.equal(actual.json.type, "all");
  },
);

test(
  "rich selectAll remains disabled when the original selection constructor is unavailable",
  browserOnly,
  async (t) => {
    const { page } = await fixture(t);
    await page.evaluate(() => {
      window.fixture.disableAllSelection();
      window.fixture.select("source");
      window.fixture.openRichMenu(["selectAll"]);
    });
    assert.equal(
      await page.getByRole("menuitem", { name: /selectAll/ }).isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
  },
);
