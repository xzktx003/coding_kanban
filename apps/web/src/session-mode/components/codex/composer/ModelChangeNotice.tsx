import { X } from "lucide-react";
import { useState } from "react";
import {
  dismissModelNotice,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { Button } from "@session/components/ui/button";
import { useModels } from "../hooks/useModels";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";

const UPGRADE_DISMISS = "kanban.session.model-upgrade-dismissed";

function dismissedUpgrades(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(UPGRADE_DISMISS) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function ModelUpgradeBanner({ threadId }: { threadId: string }) {
  const { model, modelProvider, setModel } = useThreadModelSettings(threadId);
  const fallbackModel = useConfigStore((state) => state.model);
  const { openAiModels, loading } = useModels();
  const switchNotice = useThreadModelStore((state) => state.threads[threadId]?.notice);
  const [hidden, setHidden] = useState(() => dismissedUpgrades());
  const shown = model || fallbackModel;
  if (switchNotice && !switchNotice.dismissed) return null;
  if (loading || modelProvider !== "openai" || !shown || hidden.includes(shown))
    return null;
  const current = openAiModels.find((item) => item.id === shown || item.model === shown);
  const replacementId = current?.upgradeInfo?.model ?? current?.upgrade;
  const replacement = replacementId
    ? openAiModels.find((item) => item.model === replacementId || item.id === replacementId)
    : null;
  if (!current || !replacement || replacement.model === current.model) return null;
  const retiring = current.displayName || current.model;
  const next = replacement.displayName || replacement.model;
  const info = current.upgradeInfo as
    | (NonNullable<typeof current.upgradeInfo> & {
        retirementAt?: number | null;
      })
    | null;
  const retirementAt =
    typeof info?.retirementAt === "number" && Number.isFinite(info.retirementAt)
      ? info.retirementAt
      : null;
  const retired = retirementAt != null && retirementAt * 1000 <= Date.now();
  const retirementDate =
    retirementAt == null
      ? null
      : new Intl.DateTimeFormat("zh-CN", {
          day: "numeric",
          month: "long",
        }).format(retirementAt * 1000);
  const introduced =
    replacement.model === "gpt-6-sol" &&
    ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra"].includes(current.model)
      ? "GPT-6 Sol"
      : replacement.model === "gpt-6-luna" && current.model === "gpt-5.6-luna"
        ? "GPT-6 Luna"
        : null;
  const title = introduced
    ? `认识 ${introduced}`
    : retired
      ? `${retiring} 已停用`
      : retirementDate
        ? `${retiring} 将于 ${retirementDate} 停用`
        : `${retiring} 即将停用`;
  const catalogCopy = info?.upgradeCopy?.trim();
  const description = introduced
    ? introduced === "GPT-6 Sol"
      ? "你日常处理复杂编程任务的新主力。Sol 兼顾智能与成本，除了最棘手的任务，其他都能胜任。"
      : "我们最高效的模型，比 GPT-5.6 Luna 更智能，成本更低。任何不需要前沿智能的任务，都可以交给它。"
    : catalogCopy || `此对话将自动切换到 ${next}`;
  return (
    <div role="status" aria-live="polite" className="session-model-change-notice">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setModel(replacement.id);
          if (!model) useConfigStore.getState().setModel(replacement.id);
        }}
      >
        立即切换
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="关闭模型升级横幅"
        onClick={() => {
          const nextHidden = [...hidden, shown];
          localStorage.setItem(UPGRADE_DISMISS, JSON.stringify(nextHidden));
          setHidden(nextHidden);
        }}
      >
        <X size={14} />
      </Button>
    </div>
  );
}

export function ModelChangeNotice({ threadId }: { threadId: string }) {
  const entry = useThreadModelStore((s) => s.threads[threadId]);
  const notice = entry?.notice;
  if (!notice || notice.dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="session-model-change-notice"
    >
      <span>
        模型已从 <strong>{notice.from}</strong> 更改为 <strong>{notice.to}</strong>。
        在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或切换回{" "}
        <strong>{notice.from}</strong>。
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="关闭模型切换提示"
        onClick={() => dismissModelNotice(threadId, notice.id)}
      >
        <X size={14} />
      </Button>
    </div>
  );
}
