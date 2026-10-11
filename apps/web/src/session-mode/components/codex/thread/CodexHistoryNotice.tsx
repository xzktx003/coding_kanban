import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./history-notice.css";

/** VSIX localConversation.historyLoadFailed -> mG compact warningCallout.
 * Partial live events and previously loaded rows never prove a successful read. */
export function CodexHistoryNotice({
  loading,
  loaded,
  error,
  onRetry,
}: {
  loading?: boolean;
  loaded?: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation("thread");
  if (loading && !loaded)
    return (
      <div
        role="status"
        className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        {t("historyLoading")}
      </div>
    );
  if (!error || loading) return null;
  return (
    <div className="codex-native-history-notice">
      <aside role="alert" title={error}>
        <div className="codex-native-history-content">
          <span>
            {t("nativeHistory.failed", { defaultValue: "无法加载消息" })}
          </span>
        </div>
        <div className="codex-native-history-actions">
          <button type="button" onClick={onRetry}>
            {t("historyRetry")}
          </button>
        </div>
      </aside>
    </div>
  );
}
