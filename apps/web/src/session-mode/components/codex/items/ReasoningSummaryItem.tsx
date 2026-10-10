import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { commandDurationLabel } from "../presentation/nativeCommand";
import { CodexMarkdown } from "../presentation/CodexMarkdown";
import { NativeCadencedShimmer } from "../presentation/NativeCadencedShimmer";
import { nativePublicReasoning } from "../presentation/nativeToolSemantics";
import { NativeToolDisclosure } from "./NativeToolDisclosure";

/** Only the protocol's public summary is accepted; raw reasoning is never rendered. */
export function ReasoningSummaryItem({
  summary,
  running = false,
}: {
  summary: string[];
  running?: boolean;
}) {
  const { i18n } = useTranslation("thread"),
    chinese = (i18n?.language ?? "zh").startsWith("zh"),
    value = nativePublicReasoning(summary, running);
  const observedStart = useRef<number | null>(running ? Date.now() : null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  useEffect(() => {
    if (running) {
      if (observedStart.current === null) observedStart.current = Date.now();
      setElapsed(null);
    } else if (observedStart.current !== null) {
      setElapsed(commandDurationLabel(Date.now() - observedStart.current));
      observedStart.current = null;
    }
  }, [running]);
  if (!summary.some(Boolean)) return null;
  const label = running
    ? chinese
      ? "正在思考"
      : "Thinking"
    : elapsed
      ? chinese
        ? `已思考 ${elapsed}`
        : `Thought for ${elapsed}`
      : chinese
        ? "已完成思考"
        : "Thought";
  if (running)
    return (
      <div
        className="codex-native-reasoning codex-native-reasoning-stream"
        data-public-summary
      >
        <span className="codex-native-tool-label">
          <NativeCadencedShimmer>{label}</NativeCadencedShimmer>
        </span>
        {value && (
          <div className="codex-summary-body">
            <CodexMarkdown value={value} streaming />
          </div>
        )}
      </div>
    );
  return (
    <div data-public-summary>
      <NativeToolDisclosure className="codex-native-reasoning" summary={label}>
        {value ? <CodexMarkdown value={value} /> : null}
      </NativeToolDisclosure>
    </div>
  );
}
