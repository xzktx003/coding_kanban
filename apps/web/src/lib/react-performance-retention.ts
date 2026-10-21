const REACT_TIMING_PREFIX = "__kanban_react_dev_timing__:";

/** React 19 development tracks clone props into native PerformanceMeasure entries.
 * Omit property payloads before cloning: clearing the timeline alone leaves large
 * native allocations awaiting GC even when the JS heap stays small. Keep timing
 * and track metadata for observers/DevTools, then remove timeline ownership.
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
    if (typeof options !== "object" || options === null)
      return original.call(performanceRef, name, options, endMark);
    const devtools = options.detail?.devtools;
    const react =
      devtools?.track === "Components ⚛" ||
      devtools?.trackGroup === "Scheduler ⚛";
    if (!react) return original.call(performanceRef, name, options, endMark);
    const retainedName = REACT_TIMING_PREFIX + name;
    const metadataOnly = {
      ...options,
      detail: {
        ...options.detail,
        devtools: { ...devtools, properties: null },
      },
    };
    const entry = original.call(
      performanceRef,
      retainedName,
      metadataOnly,
      endMark,
    );
    performanceRef.clearMeasures(retainedName);
    return entry;
  };
  performanceRef.measure = measure;
  return () => {
    if (performanceRef.measure === measure) performanceRef.measure = original;
  };
}
