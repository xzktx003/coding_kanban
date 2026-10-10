import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import ClaudeCodeIcon from "@session/assets/claudecode-color.svg";
import { NativeCodexUsage } from "@session/features/codex-account/NativeCodexUsage";
import { CodexAuthDialog } from "@session/components/codex/CodexAuthDialog";
import { Button } from "@session/components/ui/button";
import { Progress } from "@session/components/ui/progress";
import { getJsonWithOptions } from "@session/services/apiAdapt/shared";

type ClaudeWindow = { usedPercent: number; resetsAt: string | null } | null;
type ClaudeUsage = {
  fiveHour: ClaudeWindow;
  sevenDay: ClaudeWindow;
  fetchedAt: string;
};

function formatReset(value: number | string | null | undefined): string {
  if (value == null) return "Reset unavailable";
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "Reset unavailable";
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`;
}

function UsageRow({
  label,
  usedPercent,
  resetsAt,
  progressClassName,
}: {
  label: string;
  usedPercent: number | null | undefined;
  resetsAt: number | string | null | undefined;
  progressClassName: string;
}) {
  const available = usedPercent != null && Number.isFinite(usedPercent);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums font-semibold">
          {available ? `${Math.round(usedPercent)}% used` : "Unavailable"}
        </span>
      </div>
      <Progress
        className={progressClassName}
        value={available ? Math.max(0, Math.min(100, usedPercent)) : 0}
        aria-label={`${label} usage`}
      />
      <span className="text-xs text-muted-foreground">
        {available ? formatReset(resetsAt) : "No subscription usage data"}
      </span>
    </div>
  );
}

function ProviderSection({
  name,
  icon,
  color,
  windows,
  error,
}: {
  name: string;
  icon: string;
  color: "claude" | "codex";
  windows: {
    fiveHour: { usedPercent: number; resetsAt: number | string | null } | null;
    sevenDay: { usedPercent: number; resetsAt: number | string | null } | null;
  } | null;
  error: string | null;
}) {
  const isClaude = color === "claude";
  const progressClassName = isClaude
    ? "bg-[#d97757]/15 [&>div]:bg-[#d97757]"
    : "bg-[#7a9dff]/15 [&>div]:bg-[#6678ef]";
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border p-3 ${isClaude ? "border-[#d97757]/45 bg-[#d97757]/5" : "border-[#7a9dff]/45 bg-[#7a9dff]/5"}`}
      aria-label={`${name} usage`}
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <img src={icon} alt="" className="size-5 shrink-0" />
          {name}
        </h2>
        {error && (
          <span className="text-xs text-destructive" title={error}>
            Last update failed
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <UsageRow
          label="5 hours"
          usedPercent={windows?.fiveHour?.usedPercent}
          resetsAt={windows?.fiveHour?.resetsAt}
          progressClassName={progressClassName}
        />
        <UsageRow
          label="Weekly"
          usedPercent={windows?.sevenDay?.usedPercent}
          resetsAt={windows?.sevenDay?.resetsAt}
          progressClassName={progressClassName}
        />
      </div>
      {error && !windows && (
        <p className="text-xs text-muted-foreground">{error}</p>
      )}
    </section>
  );
}

export default function UsagePanel() {
  const [claude, setClaude] = useState<ClaudeUsage | null>(null);
  const [codexRefresh, setCodexRefresh] = useState(0);
  const [codexAuthOpen, setCodexAuthOpen] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (force) setCodexRefresh((value) => value + 1);
    setLoading(true);
    try {
      const [claudeResult] = await Promise.allSettled([
        getJsonWithOptions<ClaudeUsage>(
          `/api/claude/usage${force ? "?refresh=true" : ""}`,
          {
            suppressToast: true,
          },
        ),
      ]);
      if (claudeResult.status === "fulfilled") {
        setClaude(claudeResult.value);
        setClaudeError(null);
      } else {
        setClaudeError(
          String(
            claudeResult.reason instanceof Error
              ? claudeResult.reason.message
              : claudeResult.reason,
          ),
        );
      }
      if (claudeResult.status === "fulfilled") setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      refresh();
    }, 180_000);
    const onFocus = () => {
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return (
    <main
      id="usage-panel"
      className="flex h-screen flex-col gap-3 overflow-auto rounded-2xl border border-border bg-background p-4 text-foreground shadow-xl"
    >
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Usage limits</h1>
          <p className="text-xs text-muted-foreground">
            Claude Code and Codex account usage
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh usage"
          onClick={() => {
            refresh(true);
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </header>
      <ProviderSection
        name="Claude Code"
        icon={ClaudeCodeIcon}
        color="claude"
        windows={
          claude
            ? {
                fiveHour: claude.fiveHour,
                sevenDay: claude.sevenDay,
              }
            : null
        }
        error={claudeError}
      />
      <NativeCodexUsage
        refreshKey={codexRefresh}
        onSignIn={() => setCodexAuthOpen(true)}
        onUpdated={setLastUpdated}
      />
      <CodexAuthDialog open={codexAuthOpen} onOpenChange={setCodexAuthOpen} />
      <p className="mt-auto text-xs text-muted-foreground">
        {lastUpdated
          ? `Updated ${lastUpdated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
          : loading
            ? "Loading usage…"
            : "No usage loaded"}
      </p>
    </main>
  );
}
