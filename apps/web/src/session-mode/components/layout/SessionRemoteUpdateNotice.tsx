import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import type { GitAutoUpdateStatus } from "@agent-orchestrator/shared";
import { getAppVersion } from "../../../lib/api";

const VERSION_POLL_INTERVAL_MS = 3_000;

export function SessionRemoteUpdateNotice({
  active,
  onOpenUpdate,
}: {
  active: boolean;
  onOpenUpdate: () => void;
}) {
  const [status, setStatus] = useState<GitAutoUpdateStatus | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = () => {
      void getAppVersion()
        .then((version) => {
          if (cancelled) return;
          setStatus((current) =>
            version.autoUpdate?.phase === "checking"
              ? current
              : (version.autoUpdate ?? null),
          );
        })
        .catch(() => {});
    };
    refresh();
    const intervalId = window.setInterval(refresh, VERSION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [active]);

  if (!active || !status?.enabled) return null;
  const needsAttention =
    status.phase === "available" ||
    status.phase === "conflict" ||
    status.phase === "error";
  if (!needsAttention) return null;

  const label =
    status.phase === "available"
      ? "远程有新版本"
      : status.phase === "conflict"
        ? "远程更新存在冲突"
        : "检查远程更新失败";
  const version = [status.branch, status.remoteHead?.slice(0, 8)]
    .filter(Boolean)
    .join(" @ ");
  return (
    <button
      type="button"
      className="session-remote-update-notice"
      aria-label={`${label}，切换到终端模式处理`}
      title={`${label}${version ? `：${version}` : ""}。切换到终端模式处理`}
      onClick={onOpenUpdate}
    >
      <Download size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
