import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentInteractionVisible } from "@session/session-dom";
import type { TurnWork } from "./turnWork";
import "./turnWork.css";

export function formatTurnWorkTime(ms: number, language: string) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const parts: Array<[Intl.NumberFormatOptions["unit"], number]> = [
    ["hour", Math.floor(total / 3600)],
    ["minute", Math.floor(total / 60) % 60],
    ["second", total % 60],
  ];
  return parts
    .filter(([, value], index) => value > 0 || (total === 0 && index === 2))
    .map(([unit, value]) =>
      language.startsWith("zh")
        ? `${value}${{ hour: "小时", minute: "分钟", second: "秒" }[unit as "hour"]}`
        : new Intl.NumberFormat(language || "en", {
            style: "unit",
            unit,
            unitDisplay: "long",
          }).format(value),
    )
    .join(" ");
}

export function TurnWorkHeader({
  work,
  onToggle,
  retryNotice,
}: {
  work: TurnWork;
  onToggle(): void;
  retryNotice?: string;
}) {
  const { i18n, t } = useTranslation("thread");
  const [, tick] = useState(0);
  const visible = useAgentInteractionVisible();
  useEffect(() => {
    if (!work.running || !visible || work.startedAtMs === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [work.running, work.startedAtMs, visible]);
  const elapsed =
    work.running && work.startedAtMs !== null
      ? Math.max(0, Date.now() - work.startedAtMs)
      : work.durationMs;
  const label =
    elapsed === null
      ? t("workActivity")
      : t(work.running ? "workingFor" : "workedFor", {
          time: formatTurnWorkTime(elapsed, i18n.language),
        });
  if (work.running || !work.processKeys.size)
    return (
      <div
        className="codex-turn-work-header"
        data-running={work.running || undefined}
        data-turn-work={work.turnId}
        role={work.running ? "status" : undefined}
      >
        {label}
        {work.running && retryNotice && (
          <span className="text-yellow-600 dark:text-yellow-400">
            {" "}
            · {retryNotice}
          </span>
        )}
      </div>
    );
  return (
    <button
      type="button"
      className="codex-turn-work-header"
      data-turn-work={work.turnId}
      aria-expanded={work.expanded}
      onClick={onToggle}
    >
      <span>{label}</span>
      <ChevronRight
        aria-hidden="true"
        className={work.expanded ? "is-expanded" : ""}
        size={16}
      />
    </button>
  );
}
