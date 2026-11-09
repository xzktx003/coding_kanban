import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserSurfaceController } from "../src/browser-surface-controller.mjs";
import { createDesktopSurfaceActivation } from "../src/surface-activation.mjs";
import { pickBrowserImageFiles } from "../src/browser-image-file-picker.mjs";

const scope = Object.freeze({
  profileId: "43e56e8a-de3f-40fb-8cf3-7177d17d24f1",
  generation: "b94128f4-288c-4c97-a5cb-891555dc8199",
  viewId: "9d79066f-f08f-4f00-a75e-e24cc65e5d00",
});
const defer = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture({ delayed = false, menuFailure = false } = {}) {
  const owner = createDesktopSurfaceActivation(scope),
    document = {},
    activation = owner.bind({
      scope,
      document,
      isCurrentDocument: (value) => value === document,
    }),
    events = [],
    gate = defer(),
    menuGate = defer();
  owner.confirmActive(true);
  const capability = {
    captureScope: () => "opaque editor token",
    isScopeCurrent: (token) => token === "opaque editor token",
    getCommittedEditor: () => ({ view: "original" }),
    dispose: () => events.push("capability:dispose"),
  };
  const controller = createBrowserSurfaceController({
    window: { document },
    scope,
    modeActivation: activation,
    async initializeCapability(options) {
      assert.equal(options.modeActivation, activation);
      assert.equal(options.scope, scope);
      events.push("capability:start");
      if (delayed) await gate.promise;
      return capability;
    },
    createRichEditor(options) {
      assert.equal(options.captureScope, capability.captureScope);
      assert.equal(options.isScopeCurrent, capability.isScopeCurrent);
      assert.equal(options.getCommittedEditor, capability.getCommittedEditor);
      events.push("rich:create");
      return {
        capture() {},
        dispose() {
          events.push("rich:dispose");
        },
      };
    },
    createMenus(options) {
      assert.equal(options.captureScope, capability.captureScope);
      assert.equal(options.isScopeCurrent, capability.isScopeCurrent);
      events.push("menu:create");
      if (menuFailure) throw Error("private error");
      return {
        show: () => menuGate.promise,
        dispose() {
          events.push("menu:dispose");
        },
      };
    },
  });
  return { owner, activation, controller, events, gate, menuGate };
}

test("the bridge gets a closed menu proxy before loading any original capability", async () => {
  const f = fixture({ delayed: true }),
    proxy = f.controller.contextMenuAdapter;
  await assert.rejects(proxy.show([], {}), { code: "SURFACE_NOT_READY" });
  assert.deepEqual(f.events, []);
  const ready = f.controller.initialize();
  await assert.rejects(proxy.show([], {}), { code: "SURFACE_NOT_READY" });
  f.gate.resolve();
  await ready;
  assert.deepEqual(f.events, [
    "capability:start",
    "rich:create",
    "menu:create",
  ]);
  const decision = proxy.show([], {});
  f.menuGate.resolve({ id: "original-action" });
  assert.deepEqual(await decision, { id: "original-action" });
  f.controller.dispose();
  f.owner.close();
});

test("mode revocation cancels the old local menu and rich work synchronously, without closing native scope", async () => {
  const f = fixture();
  await f.controller.initialize();
  const old = f.activation.getSnapshot(),
    pending = f.controller.contextMenuAdapter.show([], {});
  f.owner.confirmActive(false);
  assert.equal(f.activation.isCurrent(old), false);
  assert.deepEqual(f.events.slice(-2), ["menu:dispose", "rich:dispose"]);
  assert.ok(!f.events.includes("capability:dispose"));
  f.menuGate.resolve({ id: "late" });
  await assert.rejects(pending, { code: "SURFACE_INACTIVE" });
  await assert.rejects(f.controller.contextMenuAdapter.show([], {}), {
    code: "SURFACE_INACTIVE",
  });
  f.owner.confirmActive(true);
  assert.deepEqual(f.events.slice(-2), ["rich:create", "menu:create"]);
  f.controller.dispose();
  assert.equal(f.activation.getSnapshot() !== null, true);
  f.owner.close();
});

test("disconnection during delayed initialization disposes the late capability without installing local editing", async () => {
  const f = fixture({ delayed: true }),
    ready = f.controller.initialize();
  f.controller.dispose();
  f.gate.resolve();
  await assert.rejects(ready, { code: "SURFACE_CLOSED" });
  assert.deepEqual(f.events, ["capability:start", "capability:dispose"]);
  await assert.rejects(f.controller.contextMenuAdapter.show([], {}), {
    code: "SURFACE_CLOSED",
  });
  f.controller.dispose();
  f.owner.close();
});

test("partial local setup failure releases its resources and never retries initialization", async () => {
  const f = fixture({ menuFailure: true });
  await assert.rejects(f.controller.initialize(), {
    code: "SURFACE_INITIALIZATION_FAILED",
  });
  assert.deepEqual(f.events, [
    "capability:start",
    "rich:create",
    "menu:create",
    "rich:dispose",
    "capability:dispose",
  ]);
  await assert.rejects(f.controller.initialize(), {
    code: "SURFACE_ALREADY_INITIALIZED",
  });
  await assert.rejects(f.controller.contextMenuAdapter.show([], {}), {
    code: "SURFACE_NOT_READY",
  });
  f.controller.dispose();
  f.owner.close();
});

test('v4 installs the image picker with committed composer scope and disposes it on deactivation', async () => {
  const owner=createDesktopSurfaceActivation(scope),document={},events=[];
  const activation=owner.bind({scope,document,isCurrentDocument:value=>value===document});
  owner.confirmActive(true);
  const capability={captureScope:()=>({}),isScopeCurrent:()=>true,captureAttachmentScope:()=>({}),isAttachmentScopeCurrent:()=>true,getCommittedEditor:()=>null,dispose(){events.push('capability:dispose');}};
  const controller=createBrowserSurfaceController({window:{document},scope,modeActivation:activation,
    initializeCapability:async()=>capability,
    createRichEditor:()=>({capture(){},dispose(){}}),createMenus:()=>({show(){},dispose(){}}),
    imagePickerEnabled:true,
    loadImagePicker:async()=>({installBrowserImageFilePicker(options){
      assert.equal(options.captureScope,capability.captureAttachmentScope);assert.equal(options.isScopeCurrent,capability.isAttachmentScopeCurrent);
      events.push('picker:install');return {dispose(){events.push('picker:dispose');}};
    }}),
  });
  await controller.initialize();assert.deepEqual(events,['picker:install']);
  owner.confirmActive(false);assert.deepEqual(events,['picker:install','picker:dispose']);
  owner.confirmActive(true);assert.deepEqual(events,['picker:install','picker:dispose','picker:install']);
  controller.dispose();assert.deepEqual(events,['picker:install','picker:dispose','picker:install','picker:dispose','capability:dispose']);
  owner.close();
});

test("a disposed surface never installs a late-loading image picker", async () => {
  const owner = createDesktopSurfaceActivation(scope);
  const document = {};
  const activation = owner.bind({ scope, document, isCurrentDocument: value => value === document });
  owner.confirmActive(true);
  const gate = defer();
  const entered = defer();
  const events = [];
  const controller = createBrowserSurfaceController({
    window: { document }, scope, modeActivation: activation,
    initializeCapability: async () => ({
      captureScope() {}, isScopeCurrent() { return true; }, getCommittedEditor() {},
      captureAttachmentScope() {}, isAttachmentScopeCurrent() { return true; },
      dispose() { events.push("capability:dispose"); },
    }),
    imagePickerEnabled: true,
    async loadImagePicker() { entered.resolve(); await gate.promise; return { installBrowserImageFilePicker() { events.push("picker:install"); } }; },
  });
  const ready = controller.initialize();
  await entered.promise;
  controller.dispose();
  gate.resolve();
  await assert.rejects(ready, { code: "SURFACE_CLOSED" });
  assert.deepEqual(events, ["capability:dispose"]);
  owner.close();
});

test("without the fixed v4 flag no image picker module is loaded", async () => {
  const owner = createDesktopSurfaceActivation(scope);
  const document = {};
  const activation = owner.bind({ scope, document, isCurrentDocument: value => value === document });
  const controller = createBrowserSurfaceController({
    window: { document }, scope, modeActivation: activation,
    initializeCapability: async () => ({ captureScope() {}, isScopeCurrent() { return false; }, getCommittedEditor() {}, dispose() {} }),
    loadImagePicker() { throw Error("must not load"); },
  });
  await controller.initialize();
  controller.dispose();
  owner.close();
});

test("image selection never falls back to the per-commit editing token", async () => {
  const owner = createDesktopSurfaceActivation(scope), document = {};
  const activation = owner.bind({scope,document,isCurrentDocument:value=>value===document});
  const controller = createBrowserSurfaceController({window:{document},scope,modeActivation:activation,imagePickerEnabled:true,
    initializeCapability:async()=>({captureScope(){},isScopeCurrent(){return true;},getCommittedEditor(){},dispose(){}}),
    loadImagePicker(){throw Error('must reject before importing the picker');}});
  await assert.rejects(controller.initialize(), {code:'SURFACE_INITIALIZATION_FAILED'});
  controller.dispose();owner.close();
});

test("the real picker singleton follows the active surface lifecycle", async () => {
  const owner = createDesktopSurfaceActivation(scope);
  const body = { appendChild() {} };
  const document = { body, createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) };
  const window = { document, navigator: { userActivation: { isActive: false } }, setTimeout, clearTimeout };
  const activation = owner.bind({ scope, document, isCurrentDocument: value => value === document });
  const controller = createBrowserSurfaceController({
    window, scope, modeActivation: activation, imagePickerEnabled: true,
    initializeCapability: async () => ({ captureScope: () => ({}), isScopeCurrent: () => true, captureAttachmentScope: () => ({}), isAttachmentScopeCurrent: () => true, getCommittedEditor() {}, dispose() {} }),
    createRichEditor: () => ({ capture() {}, dispose() {} }),
    createMenus: () => ({ show() {}, dispose() {} }),
  });
  await controller.initialize();
  await assert.rejects(pickBrowserImageFiles({}), /unavailable/);
  owner.confirmActive(true);
  assert.deepEqual(await pickBrowserImageFiles({ imagesOnly: true, persist() {} }), []);
  owner.confirmActive(false);
  await assert.rejects(pickBrowserImageFiles({}), /unavailable/);
  controller.dispose();
  owner.close();
});
