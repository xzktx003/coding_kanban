// Functions are self-contained because Playwright executes them in each original
// document. Observe metadata only: no request bodies, headers or full URLs.
export function installRefreshTimingObserver() {
  if (window.__kanbanRefreshTiming) return;
  const state = {
    supported: false,
    count: 0,
    totalDurationMs: 0,
    tasks: [],
    truncated: false,
    resourceBufferFull: false,
  };
  Object.defineProperty(window, "__kanbanRefreshTiming", {
    value: state,
    configurable: true,
  });
  performance.addEventListener?.("resourcetimingbufferfull", () => {
    state.resourceBufferFull = true;
  });
  if (
    typeof PerformanceObserver !== "function" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  )
    return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (
          !Number.isFinite(entry.startTime) ||
          !Number.isFinite(entry.duration) ||
          entry.startTime < 0 ||
          entry.duration < 0
        )
          continue;
        state.count++;
        state.totalDurationMs += entry.duration;
        if (state.tasks.length < 128)
          state.tasks.push({ at: entry.startTime, duration: entry.duration });
        else state.truncated = true;
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    Object.defineProperty(state, "observer", { value: observer });
    state.supported = true;
  } catch {
    /* Unsupported timing types remain explicitly unknown. */
  }
}

export function readRefreshTimingSnapshot() {
  const numeric = (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const classify = (name) => {
    try {
      const url = new URL(name, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        return { category: "non-network", asset: null };
      const candidate = url.pathname.split("/").at(-1);
      const queried = (url.searchParams.get("path") || "").split("/").at(-1);
      const isAsset = (value) =>
        typeof value === "string" &&
        /^[a-zA-Z0-9_.-]{1,160}\.(?:m?js|css|woff2?|ttf|wasm|svg|png|webp|ico)$/i.test(
          value,
        );
      const asset = isAsset(candidate)
        ? candidate
        : isAsset(queried)
          ? queried
          : null;
      const category = url.pathname.startsWith("/api/native-codex/")
        ? "native-api"
        : url.pathname.startsWith("/native-codex/")
          ? asset
            ? "native-static"
            : "native-other"
          : asset
            ? "application-static"
            : "application-other";
      const nativeOperation = url.pathname.match(
        /^\/api\/native-codex\/(?:clients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)?(status|instance-status|focus|resume|resume-beside|new-beside|open|restore|send|theme|tabs|conversations)$/,
      );
      return {
        category,
        asset,
        operation: nativeOperation?.[1] ?? null,
        sameOrigin: url.origin === location.origin,
      };
    } catch {
      return { category: "unknown", asset: null };
    }
  };
  const allResources = performance.getEntriesByType("resource");
  const resources = allResources.slice(0, 512).map((entry) => {
    const row = {
      ...classify(entry.name),
      initiator: /^[a-z]{1,20}$/i.test(entry.initiatorType)
        ? entry.initiatorType
        : "unknown",
    };
    for (const key of [
      "startTime",
      "duration",
      "fetchStart",
      "requestStart",
      "responseStart",
      "responseEnd",
      "transferSize",
      "encodedBodySize",
      "decodedBodySize",
    ])
      row[key] = numeric(entry[key]);
    row.protocol = /^(?:h[23]|http\/[12]\.\d)$/.test(entry.nextHopProtocol)
      ? entry.nextHopProtocol
      : null;
    return row;
  });
  const navigation = performance
    .getEntriesByType("navigation")
    .slice(0, 1)
    .map((entry) => {
      const row = {
        type: ["navigate", "reload", "back_forward"].includes(entry.type)
          ? entry.type
          : "unknown",
      };
      for (const key of [
        "startTime",
        "fetchStart",
        "requestStart",
        "responseStart",
        "responseEnd",
        "domInteractive",
        "domContentLoadedEventEnd",
        "loadEventEnd",
        "transferSize",
        "encodedBodySize",
        "decodedBodySize",
      ])
        row[key] = numeric(entry[key]);
      return row;
    });
  const marks = performance
    .getEntriesByType("mark")
    .filter((entry) =>
      /^code\/(?:willStartWorkbench|didStartWorkbench|willRestoreEditors|didRestoreEditors|willLoadWorkbenchMain|didLoadWorkbenchMain)$/.test(
        entry.name,
      ),
    )
    .slice(0, 32)
    .map((entry) => ({ name: entry.name, at: numeric(entry.startTime) }));
  const state = window.__kanbanRefreshTiming;
  state?.observer?.disconnect?.();
  return {
    role: document.querySelector(".monaco-workbench")
      ? "native-workbench"
      : document.querySelector(".codex-workbench")
        ? "application"
        : document.querySelector("#root")
          ? "webview"
          : "other",
    timeOrigin: numeric(performance.timeOrigin),
    observedMs: numeric(performance.now()),
    navigation,
    marks,
    resourceCount: allResources.length,
    resourcesTruncated: allResources.length > 512,
    resourceTimingBufferFull: state?.resourceBufferFull ?? null,
    resources,
    estimatedJsHeapBytes: numeric(performance.memory?.usedJSHeapSize),
    longTasks: state
      ? {
          supported: state.supported,
          count: state.count,
          totalDurationMs: state.totalDurationMs,
          truncated: state.truncated,
          tasks: state.tasks.slice(),
        }
      : { supported: false },
  };
}

export async function captureRefreshPageTimings(page) {
  const frames = page.frames();
  const results = await Promise.allSettled(
    frames.slice(0, 16).map(async (frame) => {
      let timer;
      try {
        return await Promise.race([
          frame.evaluate(readRefreshTimingSnapshot),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Timing observation timed out")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return {
    frameCount: frames.length,
    framesTruncated: frames.length > 16,
    frames: results.map((result, index) =>
      result.status === "fulfilled"
        ? { index, ...result.value }
        : { index, detached: true },
    ),
  };
}
