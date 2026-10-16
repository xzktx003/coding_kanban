import { readFileSync } from "node:fs";

function startTicks(stat, pid) {
  const prefix = /^(\d+)\s+\(/.exec(stat);
  const closing = stat.lastIndexOf(")");
  const ticks =
    closing < 0
      ? undefined
      : stat
          .slice(closing + 1)
          .trim()
          .split(/\s+/)[19];
  if (
    !prefix ||
    Number(prefix[1]) !== pid ||
    !/^\d+$/.test(ticks ?? "") ||
    BigInt(ticks) <= 0n
  )
    throw new Error(
      `Renderer stat identity for PID ${pid} is missing or invalid`,
    );
  return ticks;
}

// Total RSS of all renderer processes reported by this browser's CDP session.
// Keep per-process identities: this is not page-target heap or private/PSS data.
// Missing or unstable proc data must fail measurement, never become a low point.
export function sampleRendererRss(processInfo, readProc = readFileSync) {
  const renderers = processInfo.filter((entry) => entry.type === "renderer");
  if (!renderers.length)
    throw new Error("No renderer processes available for RSS measurement");
  const identities = new Set();
  for (const { id } of renderers) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error("Invalid renderer PID");
    if (identities.has(id)) throw new Error(`Duplicate renderer PID ${id}`);
    identities.add(id);
  }
  const rendererProcesses = renderers.map(({ id: pid }) => {
    const before = startTicks(readProc(`/proc/${pid}/stat`, "utf8"), pid);
    const status = readProc(`/proc/${pid}/status`, "utf8");
    const statusPid = /^Pid:\s+(\d+)\s*$/m.exec(status);
    if (!statusPid || Number(statusPid[1]) !== pid)
      throw new Error(`Renderer status PID mismatch for ${pid}`);
    const rss = /^VmRSS:\s+(\d+)\s+kB\s*$/m.exec(status);
    const rssBytes = rss ? Number(rss[1]) * 1024 : NaN;
    if (!Number.isSafeInteger(rssBytes) || rssBytes <= 0)
      throw new Error(`Renderer VmRSS for PID ${pid} is missing or invalid`);
    const after = startTicks(readProc(`/proc/${pid}/stat`, "utf8"), pid);
    if (before !== after)
      throw new Error(
        `Process identity changed while measuring renderer PID ${pid}`,
      );
    return { pid, startTicks: before, rssBytes };
  });
  const rendererRssBytes = rendererProcesses.reduce(
    (sum, row) => sum + row.rssBytes,
    0,
  );
  if (!Number.isSafeInteger(rendererRssBytes))
    throw new Error("Renderer VmRSS total is missing or invalid");
  return {
    rendererProcesses,
    rendererRssBytes,
  };
}
