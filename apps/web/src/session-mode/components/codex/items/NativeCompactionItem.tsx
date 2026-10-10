import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TurnStatus } from "@session/bindings/v2";
import { NativeToolDisclosure } from "./NativeToolDisclosure";
import { NativeToolIcon } from "../presentation/NativeToolIcons";
export function NativeCompactionItem({
  running = false,
  startedAtMs,
  source,
  termination,
}: {
  running?: boolean;
  startedAtMs?: number | null;
  source?: unknown;
  termination?: TurnStatus;
}) {
  const { t, i18n } = useTranslation("thread"),
    active = running && !termination;
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    setDelayed(false);
    if (
      !active ||
      typeof startedAtMs !== "number" ||
      !Number.isFinite(startedAtMs) ||
      startedAtMs <= 0
    )
      return;
    const remaining = startedAtMs + 10000 - Date.now();
    if (remaining <= 0) {
      setDelayed(true);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), remaining);
    return () => clearTimeout(timer);
  }, [active, startedAtMs]);
  const label =
    active && delayed
      ? (i18n?.language ?? "zh").startsWith("zh")
        ? "正在压缩上下文 · 可能需要几分钟"
        : "Compacting context · This can take a few minutes"
      : t(
          active
            ? "activity.compactingContext"
            : termination && termination !== "completed"
              ? "activity.compactionInterrupted"
              : source === "automatic"
                ? "activity.contextAutomaticallyCompacted"
                : "activity.contextCompacted",
        );
  return (
    <NativeToolDisclosure
      className="codex-native-compaction"
      icon={<NativeToolIcon name="compaction" />}
      running={active}
      summary={label}
    />
  );
}
