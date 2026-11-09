import test from "node:test";
import assert from "node:assert/strict";
import { createRootWithDelegateProbe } from "../src/browser-react-root-probe.mjs";

function fixture() {
  const calls = [];
  const win = {};
  class Element {
    addEventListener(...args) {
      calls.push({ self: this, args });
    }
  }
  win.Element = Element;
  const root = new Element();
  const document = { getElementById: (id) => (id === "root" ? root : null) };
  root.ownerDocument = document;
  root.isConnected = true;
  win.document = document;
  const wrapped = [];
  const probe = {
    wrapDelegatedListener(element, listener) {
      assert.equal(element, root);
      const wrapper = function (...args) {
        return listener.apply(this, args);
      };
      wrapped.push({ listener, wrapper });
      return wrapper;
    },
  };
  const add = Element.prototype.addEventListener;
  return { win, root, document, calls, wrapped, probe, add };
}

test("only bubble click/keydown registered by the original createRoot are wrapped; descriptor restores", () => {
  const f = fixture(),
    originalRoot = {},
    click = () => {},
    key = () => {},
    other = () => {};
  const result = createRootWithDelegateProbe({
    window: f.win,
    root: f.root,
    probe: f.probe,
    createRoot(root) {
      assert.equal(root, f.root);
      root.addEventListener("click", click, false);
      root.addEventListener("click", click, true);
      root.addEventListener("keydown", key, false);
      root.addEventListener("pointerdown", other, false);
      return originalRoot;
    },
  });
  assert.equal(result.value, originalRoot);
  assert.equal(result.active, true);
  assert.equal(result.restored, true);
  assert.equal(Object.hasOwn(f.root, "addEventListener"), false);
  assert.equal(f.root.addEventListener, f.add);
  assert.deepEqual(
    f.wrapped.map((x) => x.listener),
    [click, key],
  );
  assert.notEqual(f.calls[0].args[1], click);
  assert.equal(f.calls[1].args[1], click);
  assert.notEqual(f.calls[2].args[1], key);
  assert.equal(f.calls[3].args[1], other);
  assert.ok(f.calls.every((x) => x.self === f.root));
});

test("missing, duplicate or unknown original listener options keep the wrappers inert", () => {
  for (const mode of ["missing", "duplicate", "unknown"]) {
    const f = fixture();
    let invoked = 0;
    const click = () => invoked++,
      key = () => invoked++;
    const result = createRootWithDelegateProbe({
      window: f.win,
      root: f.root,
      probe: f.probe,
      createRoot(root) {
        root.addEventListener("click", click, mode === "unknown" ? {} : false);
        if (mode !== "missing") root.addEventListener("keydown", key, false);
        if (mode === "duplicate") root.addEventListener("keydown", key, false);
        return {};
      },
    });
    assert.equal(result.active, false);
    assert.equal(Object.hasOwn(f.root, "addEventListener"), false);
    for (const item of f.calls) item.args[1]();
    assert.equal(invoked, f.calls.length);
  }
});

test("original exceptions propagate while restoring the temporary own descriptor", () => {
  const f = fixture(),
    failure = new Error("original failed");
  assert.throws(
    () =>
      createRootWithDelegateProbe({
        window: f.win,
        root: f.root,
        probe: f.probe,
        createRoot(root) {
          root.addEventListener("click", () => {}, false);
          throw failure;
        },
      }),
    (error) => error === failure,
  );
  assert.equal(Object.hasOwn(f.root, "addEventListener"), false);
  assert.equal(f.root.addEventListener, f.add);
});

test("foreign root or preexisting own descriptor is never overwritten", () => {
  const f = fixture();
  let ran = 0;
  Object.defineProperty(f.root, "addEventListener", {
    configurable: true,
    writable: true,
    value: f.add,
  });
  const result = createRootWithDelegateProbe({
    window: f.win,
    root: f.root,
    probe: f.probe,
    createRoot() {
      ran++;
      return {};
    },
  });
  assert.equal(result.active, false);
  assert.equal(ran, 1);
  assert.equal(Object.hasOwn(f.root, "addEventListener"), true);
});

test("a falsy original exception is propagated and the hook is retired", () => {
  const f = fixture();
  let caught = false,
    thrown;
  try {
    createRootWithDelegateProbe({
      window: f.win,
      root: f.root,
      probe: f.probe,
      createRoot() {
        throw undefined;
      },
    });
  } catch (error) {
    caught = true;
    thrown = error;
  }
  assert.equal(caught, true);
  assert.equal(thrown, undefined);
  assert.equal(Object.hasOwn(f.root, "addEventListener"), false);
});

test("a replaced hook is never removed and restoration failure is not reported as zero hooks", () => {
  const f = fixture(),
    replacement = () => {};
  const result = createRootWithDelegateProbe({
    window: f.win,
    root: f.root,
    probe: f.probe,
    createRoot(root) {
      root.addEventListener("click", () => {}, false);
      root.addEventListener("keydown", () => {}, false);
      Object.defineProperty(root, "addEventListener", {
        value: replacement,
        configurable: true,
      });
      return {};
    },
  });
  assert.equal(result.active, false);
  assert.equal(result.restored, false);
  assert.equal(f.root.addEventListener, replacement);
});
