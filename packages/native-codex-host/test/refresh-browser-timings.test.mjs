import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  installRefreshTimingObserver,
  readRefreshTimingSnapshot,
} from "../../../tests/e2e/codex-refresh-timings.mjs";

function snapshot(resources = [], marks = []) {
  return vm.runInNewContext(`(${readRefreshTimingSnapshot.toString()})()`, {
    location: {
      origin: "https://private.invalid",
      href: "https://private.invalid/",
    },
    document: { querySelector: () => null },
    window: {},
    URL,
    performance: {
      timeOrigin: 1000,
      now: () => 40,
      getEntriesByType: (type) =>
        type === "resource" ? resources : type === "mark" ? marks : [],
    },
  });
}

test("refresh timings retain only static asset names and numeric timing, never credentials or query values", () => {
  const result = snapshot([
    {
      name: "https://user:secret@private.invalid/native-codex/vscode-remote-resource?path=%2Fprivate%2Flogin-home%2Fwebview%2Fassets%2Fapp-initial-a123.js&token=secret",
      initiatorType: "script",
      duration: 20,
      transferSize: 123,
      encodedBodySize: 100,
      decodedBodySize: 200,
    },
    {
      name: "https://private.invalid/api/native-codex/clients/019aabcd-1234-7890-abcd-0123456789ab/status?credential=secret",
      initiatorType: "fetch",
      duration: 3,
    },
    {
      name: "https://private.invalid/native-codex/private-conversation-name/secret?text=secret",
      initiatorType: "fetch",
    },
    { name: "data:text/plain,secret", initiatorType: "other" },
  ]);
  const text = JSON.stringify(result);
  for (const forbidden of [
    "secret",
    "login-home",
    "private-conversation-name",
    "user:",
    "credential",
    "token=",
  ])
    assert.equal(text.includes(forbidden), false);
  assert.equal(result.resources[0].asset, "app-initial-a123.js");
  assert.equal(result.resources[0].transferSize, 123);
  assert.equal(result.resources[1].category, "native-api");
  assert.equal(result.resources[1].operation, "status");
  assert.equal(result.resources[2].category, "native-other");
});

test("native operation timings retain only fixed endpoint names, never arbitrary path segments", () => {
  const result = snapshot([
    {
      name: "https://private.invalid/api/native-codex/clients/019aabcd-1234-7890-abcd-0123456789ab/resume-beside?cwd=private-secret",
      initiatorType: "fetch",
    },
    {
      name: "https://private.invalid/api/native-codex/focus",
      initiatorType: "fetch",
    },
    {
      name: "https://private.invalid/api/native-codex/private-secret",
      initiatorType: "fetch",
    },
    {
      name: "https://private.invalid/api/native-codex/clients/private-secret/status",
      initiatorType: "fetch",
    },
    {
      name: "https://private.invalid/api/native-codex/unexpected-path/status",
      initiatorType: "fetch",
    },
  ]);
  assert.equal(result.resources[0].operation, "resume-beside");
  assert.equal(result.resources[1].operation, "focus");
  assert.equal(result.resources[2].operation, null);
  assert.equal(result.resources[3].operation, null);
  assert.equal(result.resources[4].operation, null);
  assert.equal(JSON.stringify(result).includes("private-secret"), false);
});

test("resource and mark retention is bounded and invalid numeric fields never become measurements", () => {
  const resources = Array.from({ length: 600 }, () => ({
    name: "https://private.invalid/static/main.js",
    duration: Infinity,
    transferSize: -1,
    decodedBodySize: NaN,
  }));
  const marks = Array.from({ length: 70 }, (_, index) => ({
    name: index % 2 ? "code/didStartWorkbench" : "private-secret",
    startTime: index,
  }));
  const result = snapshot(resources, marks);
  assert.equal(result.resourceCount, 600);
  assert.equal(result.resources.length, 512);
  assert.equal(result.resourcesTruncated, true);
  assert.ok(result.marks.length <= 32);
  assert.ok(
    result.marks.every((mark) => mark.name === "code/didStartWorkbench"),
  );
  assert.equal(result.resources[0].duration, null);
  assert.equal(result.resources[0].transferSize, null);
  assert.equal(JSON.stringify(result).includes("private-secret"), false);
});

test("long-task observation is bounded, idempotent and never clears the original performance timeline", () => {
  let callback,
    observes = 0,
    cleared = 0;
  const context = vm.createContext({
    window: {},
    performance: {
      clearMarks() {
        cleared++;
      },
      clearMeasures() {
        cleared++;
      },
    },
    PerformanceObserver: class {
      static supportedEntryTypes = ["longtask"];
      constructor(listener) {
        callback = listener;
      }
      observe() {
        observes++;
      }
    },
  });
  vm.runInContext(`(${installRefreshTimingObserver.toString()})()`, context);
  vm.runInContext(`(${installRefreshTimingObserver.toString()})()`, context);
  callback({
    getEntries: () =>
      Array.from({ length: 300 }, (_, index) => ({
        startTime: index,
        duration: 51,
      })),
  });
  const state = context.window.__kanbanRefreshTiming;
  assert.equal(observes, 1);
  assert.equal(state.count, 300);
  assert.equal(state.tasks.length, 128);
  assert.equal(state.totalDurationMs, 300 * 51);
  assert.equal(state.truncated, true);
  assert.equal(cleared, 0);
});

test("unsupported long-task metrics and a full native resource buffer remain explicit limitations", () => {
  let full;
  const context = vm.createContext({
    window: {},
    PerformanceObserver: class {
      static supportedEntryTypes = ["resource"];
      constructor() {
        throw Error("unsupported observer must not be installed");
      }
    },
    performance: {
      addEventListener(name, callback) {
        assert.equal(name, "resourcetimingbufferfull");
        full = callback;
      },
    },
  });
  vm.runInContext(`(${installRefreshTimingObserver.toString()})()`, context);
  full();
  assert.equal(context.window.__kanbanRefreshTiming.supported, false);
  assert.equal(context.window.__kanbanRefreshTiming.resourceBufferFull, true);
});
