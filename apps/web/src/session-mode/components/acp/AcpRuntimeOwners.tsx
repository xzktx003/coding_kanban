import { useState } from "react";
import { buildUrl } from "@session/hooks/runtime";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import {
  useAcpRuntimeOwnersStore,
  openAcpRuntimeOwner,
} from "@session/services/acpRuntimeOwners";
export function AcpRuntimeOwners() {
  const names = useSessionNameStore((s) => s.names);
  const owners = useAcpRuntimeOwnersStore((s) => s.owners),
    current = useAcpStore((s) =>
      s.active ? [s.connectionId, s.sessionId].join(":") : null,
    );
  const [error, setError] = useState<string | null>(null);
  const rows = Object.values(owners)
    .filter(
      (owner) =>
        !owner.closed &&
        owner.endpoint === buildUrl("/api/acp/connection-snapshot") &&
        `${owner.connectionId}:${owner.sessionId}` !== current,
    )
    .sort((a, b) => b.lastUsed - a.lastUsed);
  if (!rows.length) return null;
  return (
    <section
      aria-label="ACP 已有会话"
      className="shrink-0 border-b border-border/60 bg-muted/20 px-3 py-2 text-xs"
    >
      <p className="mb-1 text-muted-foreground">
        已有 Agent 会话 · 切换不停止后台任务
      </p>
      <div className="flex flex-wrap gap-2">
        {rows.map((owner) => {
          const name =
            names[`acp:${owner.agentId}:${owner.historySessionId}`] ??
            owner.title;
          const marker =
            owner.historySessionId?.slice(-8) ?? owner.sessionId.slice(0, 8);
          return (
            <button
              key={owner.key}
              data-acp-owner-connection={owner.connectionId}
              data-acp-owner-history={owner.historySessionId}
              className="min-h-11 max-w-full rounded-md border border-border px-3 py-1.5 text-left hover:bg-accent"
              aria-label={`返回 ${name} · ${marker}`}
              onClick={() => {
                try {
                  openAcpRuntimeOwner(owner.key);
                  setError(null);
                } catch (reason) {
                  setError(String(reason));
                }
              }}
            >
              <span className="block truncate font-medium">
                {name} · {marker}
              </span>
              <span className="text-muted-foreground">
                {!owner.verified
                  ? "待核验"
                  : owner.pendingCount
                    ? `待审批 ${owner.pendingCount}`
                    : owner.running
                      ? "运行中"
                      : "空闲"}
                {owner.permissionTitles[0]
                  ? ` · ${owner.permissionTitles[0]}`
                  : ""}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
