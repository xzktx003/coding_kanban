import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
} from "@session/session-dom";
import { nativeNotifications } from "@session/features/native-notifications/service";
import {
  dismissModelNotice,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { Button } from "@session/components/ui/button";
import { useModels } from "../hooks/useModels";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";

import { useCodexStore } from "../stores/useCodexStore";

const UPGRADE_DISMISS = "kanban.session.model-upgrade-dismissed";

function dismissedUpgrades(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(UPGRADE_DISMISS) ?? "[]");
    return Array.isArray(saved)
      ? saved.filter((id) => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function ModelUpgradeBanner({ threadId }: { threadId: string }) {
  const { model, modelProvider, setModel } = useThreadModelSettings(threadId);
  const fallbackModel = useConfigStore((state) => state.model);
  const { openAiModels, loading } = useModels();
  const [hidden, setHidden] = useState(() => dismissedUpgrades());
  const shown = model || fallbackModel;
  if (loading || modelProvider !== "openai" || !shown || hidden.includes(shown))
    return null;
  const current = openAiModels.find(
    (item) => item.id === shown || item.model === shown,
  );
  const replacementId = current?.upgradeInfo?.model ?? current?.upgrade;
  const replacement = replacementId
    ? openAiModels.find(
        (item) => item.model === replacementId || item.id === replacementId,
      )
    : null;
  if (!current || !replacement || replacement.model === current.model)
    return null;
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
    <div
      role="status"
      aria-live="polite"
      className="session-model-change-notice"
    >
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

type ModelSelectionSource = "power" | "recent";
type ModelSelectionNoticeEvent = {
  threadId: string;
  source: ModelSelectionSource;
  noticeId: number;
  identity?: string;
};
const selectionListeners = new Set<
  (event: ModelSelectionNoticeEvent) => void
>();

/** Signal only a user operation accepted by the existing settings setter. Never
 * infer a picker commit from restoration, a radio selection, or a store update. */
export function commitModelSelectionWithNotice(
  threadId: string | null | undefined,
  source: ModelSelectionSource,
  commit: () => void,
) {
  const before = threadId
    ? useThreadModelStore.getState().threads[threadId]
    : undefined;
  commit();
  const after = threadId
    ? useThreadModelStore.getState().threads[threadId]
    : undefined;
  if (
    !threadId ||
    !before ||
    !after?.pending ||
    before.modelProvider !== "openai" ||
    after.modelProvider !== "openai" ||
    before.model === after.model ||
    !after.notice ||
    after.notice.id <= before.revision ||
    after.notice.dismissed
  )
    return;
  const event = { threadId, source, noticeId: after.notice.id, identity: after.notice.identity };
  for (const listener of selectionListeners) listener(event);
}

/** Ephemeral operation notice. The native SDK rollout/family gate is not
 * exposed by the Session transport; this retains the existing local v2 copy.
 * See model-change-notice-behavior-20261027.md for that unclosed boundary. */
export function ModelChangeNotice({ threadId }: { threadId: string }) {
  const visible = useAgentInteractionVisible();
  const warnedTurn = useRef<{ threadId: string; turnId: string } | null>(null);
  useEffect(() => {
    const onSelection = (event: ModelSelectionNoticeEvent) => {
      if (event.threadId !== threadId || !isAgentInteractionVisible()) return;
      const entry = useThreadModelStore.getState().threads[threadId];
      const notice = entry?.notice;
      if (!entry?.pending || !notice || notice.id !== event.noticeId || notice.identity !== event.identity) return;
      // Inspect the existing bounded projection once. Do not subscribe to or
      // retain bodies, wake dormant transcripts, or fetch history for a warning.
      const state = useCodexStore.getState();
      const hasTurn = state.events[threadId]?.some(({ params }) => {
        if (!("threadId" in params) || params.threadId !== threadId)
          return false;
        return (
          ("turnId" in params && typeof params.turnId === "string") ||
          ("turn" in params &&
            params.turn != null &&
            typeof params.turn === "object" &&
            "id" in params.turn &&
            typeof params.turn.id === "string")
        );
      });
      if (!hasTurn) return;
      const turnId = state.turnTimingMap[threadId]?.turnId;
      if (event.source === "power") {
        if (
          !turnId ||
          (warnedTurn.current?.threadId === threadId &&
            warnedTurn.current.turnId === turnId)
        )
          return;
        warnedTurn.current = { threadId, turnId };
      }
      if (notice.dismissed) return;
      // Claim the exact notice before notifying duplicate mounted surfaces.
      dismissModelNotice(threadId, notice.id, notice.identity);
      nativeNotifications.info(
        `在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或切换回 ${notice.from}。`,
        { id: `composer.modelChangeDuringConversationWarning.${threadId}` },
      );
    };
    selectionListeners.add(onSelection);
    return () => {
      selectionListeners.delete(onSelection);
    };
  }, [threadId, visible]);
  return null;
}
