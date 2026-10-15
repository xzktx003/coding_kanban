// Raw CDP profiles contain full URLs. Reduce in memory; never persist the profile.
export function summarizeRefreshCpu(profile, { countsOnly = false } = {}) {
  if (
    !profile ||
    !Array.isArray(profile.nodes) ||
    profile.nodes.length > 200000 ||
    !Array.isArray(profile.samples) ||
    profile.samples.length > 500000 ||
    !Array.isArray(profile.timeDeltas) ||
    profile.samples.length !== profile.timeDeltas.length ||
    !Number.isFinite(profile.startTime) ||
    !Number.isFinite(profile.endTime) ||
    profile.endTime < profile.startTime
  )
    throw new Error("Invalid bounded CPU profile");
  const nodes = new Map(),
    parents = new Map(),
    rows = new Map();
  const numeric = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  for (const node of profile.nodes) {
    if (!Number.isSafeInteger(node.id) || node.id < 1 || nodes.has(node.id))
      throw new Error("Invalid CPU node identity");
    const call = node.callFrame || {};
    let asset = "runtime",
      category = "runtime";
    if (
      ["(idle)", "(program)", "(garbage collector)", "(root)"].includes(
        call.functionName,
      )
    )
      asset = `runtime:${call.functionName}`;
    else
      try {
        const url = new URL(call.url),
          queried = url.searchParams.get("path") || "",
          path = queried || url.pathname;
        const candidate = path.split("/").at(-1);
        if (
          ["https:", "http:"].includes(url.protocol) &&
          /^[a-zA-Z0-9_.-]{1,160}\.(?:m?js|tsx?)$/i.test(candidate || "")
        ) {
          asset = candidate;
          category = path.includes("/src/codex-mode/")
            ? "kanban-codex"
            : path.includes("/src/session-mode/")
              ? "kanban-session"
              : /\/openai\.chatgpt-[^/]+\/webview\/assets\//.test(path)
                ? "official-webview"
                : path.includes("/vs/")
                  ? "code-server"
                  : "application-library";
        }
      } catch {
        /* Unnamed and internal code remains an anonymous runtime row. */
      }
    const key = category + ":" + asset;
    nodes.set(node.id, {
      key,
      line: numeric(call.lineNumber),
      column: numeric(call.columnNumber),
    });
    if (!rows.has(key))
      rows.set(key, {
        asset,
        category,
        selfMs: 0,
        inclusiveMs: 0,
        samples: 0,
        inclusiveSamples: 0,
        locations: new Map(),
      });
    if (
      node.children !== undefined &&
      (!Array.isArray(node.children) || node.children.length > 200000)
    )
      throw new Error("Invalid CPU children");
    for (const child of node.children || []) {
      if (parents.has(child)) throw new Error("Ambiguous CPU parent");
      parents.set(child, node.id);
    }
  }
  let sampleDurationMs = 0,
    stackDepthTruncated = false,
    nonMonotonicDeltas = 0;
  for (let index = 0; index < profile.samples.length; index++) {
    const id = profile.samples[index],
      node = nodes.get(id),
      delta = profile.timeDeltas[index];
    if (!node) throw new Error("CPU sample references a missing node");
    if (typeof delta !== "number" || !Number.isFinite(delta))
      throw new Error("CPU sample has a non-finite time delta");
    if (delta < 0) {
      nonMonotonicDeltas++;
      if (!countsOnly)
        throw new Error(
          `CPU sample has a negative time delta (${delta} microseconds)`,
        );
    }
    const duration = countsOnly ? 0 : delta / 1000,
      row = rows.get(node.key);
    sampleDurationMs += duration;
    row.selfMs += duration;
    row.samples++;
    const location = `${node.line}:${node.column}`;
    const previous = row.locations.get(location) || {
      line: node.line,
      column: node.column,
      selfMs: 0,
      samples: 0,
    };
    previous.selfMs += duration;
    previous.samples++;
    row.locations.set(location, previous);
    const seenAssets = new Set(),
      seenIds = new Set();
    let cursor = id;
    for (let depth = 0; cursor !== undefined; depth++) {
      if (seenIds.has(cursor)) throw new Error("Cyclic CPU stack");
      if (depth >= 64) {
        stackDepthTruncated = true;
        break;
      }
      seenIds.add(cursor);
      const current = nodes.get(cursor);
      if (!current) throw new Error("Missing CPU stack node");
      if (!seenAssets.has(current.key)) {
        rows.get(current.key).inclusiveMs += duration;
        rows.get(current.key).inclusiveSamples++;
        seenAssets.add(current.key);
      }
      cursor = parents.get(cursor);
    }
  }
  const assets = [...rows.values()]
    .filter((row) => row.samples || row.inclusiveSamples)
    .sort((left, right) =>
      countsOnly ? right.samples - left.samples : right.selfMs - left.selfMs,
    );
  return {
    elapsedMs: (profile.endTime - profile.startTime) / 1000,
    sampleDurationMs: countsOnly ? null : sampleDurationMs,
    durationMetricsValid: !countsOnly,
    nonMonotonicDeltas,
    sampleCount: profile.samples.length,
    nodeCount: profile.nodes.length,
    sourceLocationBase: "zero-based",
    stackDepthTruncated,
    assetsTruncated: assets.length > 128,
    assets: assets.slice(0, 128).map(({ locations, ...row }) => ({
      ...row,
      ...(countsOnly ? { selfMs: null, inclusiveMs: null } : {}),
      topLocations: [...locations.values()]
        .sort((left, right) =>
          countsOnly
            ? right.samples - left.samples
            : right.selfMs - left.selfMs,
        )
        .slice(0, 10)
        .map((location) =>
          countsOnly ? { ...location, selfMs: null } : location,
        ),
    })),
  };
}
