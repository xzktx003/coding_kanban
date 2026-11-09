import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDesktopConnection,
  desktopConnectionEnvironment,
  desktopConnectionArguments,
} from "../src/connection-policy.mjs";

test("no connection preserves the native empty environment and never inherits ambient proxies", () => {
  assert.equal(normalizeDesktopConnection(undefined), undefined);
  assert.deepEqual(desktopConnectionEnvironment(undefined), {});
  assert.deepEqual(desktopConnectionArguments(undefined), []);
});

test("an explicit fixed connection copies only supported values and produces a frozen private environment", () => {
  const input = {
    httpProxy: "http://proxy.test:8123",
    httpsProxy: "http://proxy.test:8123",
    noProxy: "localhost,127.0.0.1,::1,.example.test,10.0.0.0/8",
  };
  const saved = normalizeDesktopConnection(input);
  assert.notEqual(saved, input);
  assert.ok(Object.isFrozen(saved));
  input.httpProxy = "http://other.test:1";
  const env = desktopConnectionEnvironment(saved);
  assert.deepEqual(env, {
    http_proxy: "http://proxy.test:8123",
    https_proxy: "http://proxy.test:8123",
    NO_PROXY: saved.noProxy,
    no_proxy: saved.noProxy,
  });
  assert.ok(Object.isFrozen(env));
  assert.equal(Object.hasOwn(env, "NODE_OPTIONS"), false);
  assert.equal(Object.hasOwn(env, "NODE_USE_ENV_PROXY"), false);
  assert.deepEqual(desktopConnectionArguments(saved), [
    "--proxy-server=http=http://proxy.test:8123;https=http://proxy.test:8123",
    "--proxy-bypass-list=localhost;*.localhost;127.0.0.1;[::1];example.test;*.example.test;10.0.0.0/8",
  ]);
});

test("connection validation rejects arbitrary fields, credentials, URL paths, controls and accessors without reading them", () => {
  for (const connection of [
    null,
    false,
    [],
    {},
    { noProxy: "*" },
    { httpProxy: "socks5://proxy.test:1" },
    { httpProxy: "http://user:secret@proxy.test:1" },
    { httpProxy: "http://proxy.test:1/path" },
    { httpProxy: "http://proxy.test:1?key=secret" },
    { httpProxy: "http://proxy.test:1#fragment" },
    { httpProxy: "http://proxy.test:1\n" },
    { httpProxy: "http://proxy.test:1", NODE_OPTIONS: "--require attack" },
    { httpProxy: "http://proxy.test:1", noProxy: "bad\nvalue" },
    { httpProxy: "http://proxy.test:1", noProxy: "x".repeat(4097) },
  ]) {
    assert.throws(
      () => normalizeDesktopConnection(connection),
      (error) =>
        error.code === "CONTAINER_INVALID_CONNECTION" &&
        !error.message.includes("secret"),
    );
  }
  let read = false;
  const input = {};
  Object.defineProperty(input, "httpProxy", {
    enumerable: true,
    get() {
      read = true;
      return "http://proxy.test:1";
    },
  });
  assert.throws(() => normalizeDesktopConnection(input));
  assert.equal(read, false);
});
