import assert from "node:assert/strict";
import {
  performance as nativePerformance,
  PerformanceObserver,
} from "node:perf_hooks";
import test from "node:test";
import { installReactPerformanceRetention } from "./react-performance-retention";

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
    assert.deepEqual((entries[0] as PerformanceMeasure).detail, detail);
  } finally {
    observer?.disconnect();
    restore();
    nativePerformance.clearMeasures();
  }
});
