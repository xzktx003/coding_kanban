import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThreadTokenUsage } from "@session/bindings/v2/ThreadTokenUsage";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@session/components/ui/tooltip";

/** Native _ma: the last response's context, never cumulative billed tokens. */
export function deriveContextWindowUsage(usage?: ThreadTokenUsage | null) {
  const capacity = usage?.modelContextWindow;
  const last = usage?.last?.totalTokens;
  if (
    capacity == null ||
    last == null ||
    !Number.isFinite(capacity) ||
    !Number.isFinite(last) ||
    capacity <= 0 ||
    last < 0
  )
    return null;
  const used = Math.min(last, capacity);
  return { percent: (used / capacity) * 100, used, capacity };
}

export function ContextWindowWidget() {
  const threadId = useCodexStore((s) => s.currentThreadId);
  const usage = useCodexStore((s) =>
    threadId ? s.tokenUsageMap[threadId] : null,
  );
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [threadId]);
  const context = deriveContextWindowUsage(usage);
  if (!context) return null;
  const percent = Math.round(context.percent);
  const number = new Intl.NumberFormat(zh ? "zh-CN" : "en", {
    maximumFractionDigits: 0,
  });
  const label = zh
    ? `上下文用量：${number.format(context.percent)}%`
    : `Context usage: ${number.format(context.percent)}%`;
  const used = number.format(Math.round(context.used / 1000));
  const capacity = number.format(Math.round(context.capacity / 1000));
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="session-native-context-usage"
            aria-label={label}
            onClick={() => setOpen((current) => !current)}
          >
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
              <circle
                cx="6"
                cy="6"
                r="5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                opacity=".16"
              />
              <circle
                cx="6"
                cy="6"
                r="5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                opacity={context.percent === 0 ? 0 : 1}
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={100 - context.percent}
                strokeLinecap="round"
                transform="rotate(-90 6 6)"
              />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent
          className="session-native-composer-tooltip session-native-context-tooltip"
          side="top"
          align="center"
          sideOffset={4}
          collisionPadding={8}
        >
          <div className="session-native-context-description">
            <span>{zh ? "背景信息窗口：" : "Context window:"}</span>
            <span className={percent >= 50 ? "is-full" : undefined}>
              {zh
                ? percent >= 50
                  ? `${percent}% 已用`
                  : `${percent}% 已用（剩余 ${100 - percent}%）`
                : percent >= 50
                  ? `${percent}% full`
                  : `${percent}% used (${100 - percent}% left)`}
            </span>
            <span>
              {zh
                ? `已用 ${used}k 标记，共 ${capacity}k`
                : `${used}k / ${capacity}k tokens used`}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
