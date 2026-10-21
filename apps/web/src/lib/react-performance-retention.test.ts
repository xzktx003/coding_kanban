import assert from "node:assert/strict";
import {
  performance as nativePerformance,
  PerformanceObserver,
} from "node:perf_hooks";
import test from "node:test";
import { installReactPerformanceRetention } from "./react-performance-retention";

test("React properties are removed before native cloning without changing caller metadata", () => {
  const calls: unknown[][] = [];
  const cleared: string[] = [];
  const performanceRef = {
    measure(...args: unknown[]) {
      calls.push(args);
      return { name: args[0] } as PerformanceMeasure;
    },
    clearMeasures(name?: string) {
      cleared.push(name!);
    },
  };
  const restore = installReactPerformanceRetention(performanceRef, true);
  try {
    for (const track of [
      { track: "Components ⚛" },
      { track: "Blocking", trackGroup: "Scheduler ⚛" },
    ]) {
      const properties = Object.freeze([["body", "component properties"]]);
      const detail = Object.freeze({
        application: "preserved",
        devtools: Object.freeze({
          ...track,
          color: "primary",
          tooltipText: "render",
          properties,
        }),
      });
      const options = Object.freeze({ start: 12, duration: 3, detail });
      performanceRef.measure("component", options);
      assert.deepEqual(calls.at(-1), [
        "__kanban_react_dev_timing__:component",
        {
          ...options,
          detail: {
            ...detail,
            devtools: { ...detail.devtools, properties: null },
          },
        },
        undefined,
      ]);
      assert.equal(options.detail, detail);
      assert.equal(detail.devtools.properties, properties);
    }
    const application = {
      start: 0,
      end: 1,
      detail: {
        devtools: { track: "Application", properties: [["keep", "value"]] },
      },
    };
    performanceRef.measure("application", application);
    assert.equal(calls.at(-1)![1], application);
    performanceRef.measure("marks", "start", "end");
    assert.deepEqual(calls.at(-1), ["marks", "start", "end"]);
    assert.deepEqual(
      cleared,
      Array(2).fill("__kanban_react_dev_timing__:component"),
    );
  } finally {
    restore();
  }
});

test("development React timing does not retain cloned component properties in the native timeline", () => {
  const original = nativePerformance.measure;
  const restore = installReactPerformanceRetention(nativePerformance, true);
  const react = {
    start: 0,
    end: 1,
    detail: {
      devtools: {
        track: "Components ⚛",
        properties: [["body", "x".repeat(65536)]],
      },
    },
  };
  try {
    nativePerformance.measure("shared-name", {
      start: 0,
      end: 1,
      detail: { application: true },
    });
    for (let i = 0; i < 100; i++)
      nativePerformance.measure("shared-name", react);
    nativePerformance.measure("scheduler", {
      start: 0,
      end: 1,
      detail: { devtools: { track: "Blocking", trackGroup: "Scheduler ⚛" } },
    });
    assert.equal(nativePerformance.getEntriesByType("measure").length, 1);
    assert.equal(
      (
        nativePerformance.getEntriesByName(
          "shared-name",
        )[0] as PerformanceMeasure
      ).detail.application,
      true,
    );
    nativePerformance.mark("unrelated-mark");
    assert.equal(nativePerformance.getEntriesByType("mark").length, 1);
  } finally {
    restore();
    nativePerformance.clearMeasures();
    nativePerformance.clearMarks();
  }
  assert.equal(nativePerformance.measure, original);
});

test("production and unsupported performance APIs remain untouched", () => {
  const original = nativePerformance.measure;
  installReactPerformanceRetention(nativePerformance, false)();
  assert.equal(nativePerformance.measure, original);
  const detail = {
    devtools: { track: "Components ⚛", properties: [["body", "keep"]] },
  };
  const entry = nativePerformance.measure("production-react", {
    start: 0,
    end: 1,
    detail,
  });
  assert.deepEqual(entry.detail, detail);
  nativePerformance.clearMeasures("production-react");
  installReactPerformanceRetention(undefined, true)();
});

test("observers still receive scoped React timing labels and devtools metadata after timeline cleanup", async () => {
  const restore = installReactPerformanceRetention(nativePerformance, true);
  let observer: PerformanceObserver | undefined;
  try {
    const delivered = new Promise<import("node:perf_hooks").PerformanceEntry[]>(
      (resolve) => {
        observer = new PerformanceObserver((list) =>
          resolve(list.getEntries()),
        );
        observer.observe({ entryTypes: ["measure"] });
      },
    );
    const detail = {
      devtools: { track: "Components ⚛", properties: [["prop", "value"]] },
    };
    nativePerformance.measure("component", { start: 0, end: 1, detail });
    assert.equal(nativePerformance.getEntriesByType("measure").length, 0);
    const entries = await delivered;
    assert.equal(entries[0].name, "__kanban_react_dev_timing__:component");
    assert.deepEqual((entries[0] as PerformanceMeasure).detail, {
      devtools: { track: "Components ⚛", properties: null },
    });
    assert.deepEqual(detail.devtools.properties, [["prop", "value"]]);
  } finally {
    observer?.disconnect();
    restore();
    nativePerformance.clearMeasures();
  }
});
