const REACT_TIMING_PREFIX = "__kanban_react_dev_timing__:";

/** React 19 development tracks clone props into native PerformanceMeasure entries.
 * Let observers/DevTools receive each entry, then remove its timeline ownership.
 * A reserved name prevents clearing unrelated application measures with the same
 * component/phase name. Production React does not generate these debug tracks.
 */
export function installReactPerformanceRetention(
  performanceRef: Pick<Performance, "measure" | "clearMeasures"> | undefined,
  development: boolean,
) {
  if (!development || !performanceRef?.measure || !performanceRef.clearMeasures)
    return () => {};
  const original = performanceRef.measure;
  const measure: Performance["measure"] = (name, options, endMark) => {
    const devtools =
      typeof options === "object" && options !== null
        ? options.detail?.devtools
        : undefined;
    const react =
      devtools?.track === "Components ⚛" ||
      devtools?.trackGroup === "Scheduler ⚛";
    if (!react) return original.call(performanceRef, name, options, endMark);
    const retainedName = REACT_TIMING_PREFIX + name;
    const entry = original.call(performanceRef, retainedName, options, endMark);
    performanceRef.clearMeasures(retainedName);
    return entry;
  };
  performanceRef.measure = measure;
  return () => {
    if (performanceRef.measure === measure) performanceRef.measure = original;
  };
}
