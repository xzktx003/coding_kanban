import { Box } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useModelCacheStore } from "@session/components/codex/hooks/useModels";
import { useModelSettingsStore } from "@session/stores/settings/useModelSettingsStore";
import { NativeToolIcon } from "@session/components/codex/presentation/NativeToolIcons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@session/components/ui/tooltip";
import type { ModelChangeAnnouncement } from "./modelChangeTranscript";

export function ModelChangeAnnouncements({ changes }: { changes?: readonly ModelChangeAnnouncement[] }) {
  const { i18n } = useTranslation("thread");
  const chinese = (i18n?.language ?? "zh").startsWith("zh");
  const accountType = useCodexStore((state) => state.account?.type);
  const catalog = useModelCacheStore((state) => state.openAiModels);
  const custom = useModelSettingsStore((state) => state.models);
  const label = (value: ModelChangeAnnouncement["from"]) => {
    const customName = custom[value.provider]?.find((item) => item.id === value.model)?.name;
    const known = catalog.find((item) => item.id === value.model || item.model === value.model);
    const model = customName || known?.displayName || value.model;
    const provider = value.provider === "openai"
      ? accountType === "chatgpt" ? "ChatGPT API" : accountType === "apiKey" ? "OpenAI API" : "OpenAI"
      : value.provider;
    return `${model} · ${provider}`;
  };
  return changes?.map((change) => (
    <div key={change.key} data-model-change-notice className="codex-native-notice codex-native-divider session-model-transcript-change" role="status">
      <span className="codex-native-divider-message">
        <Box size={16} aria-hidden="true" />
        <span>{chinese ? `模型已从 ${label(change.from)} 更改为 ${label(change.to)}。` : `Model changed from ${label(change.from)} to ${label(change.to)}.`}</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={chinese ? "模型切换详情" : "Model change details"}>
                <NativeToolIcon name="info" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="codex-file-preview session-model-change-tooltip max-w-64 text-center" hideArrow sideOffset={6} collisionPadding={8}>
              {chinese ? "后续轮次使用更新后的设置。正在运行的轮次可能继续使用此前的设置。" : "Later turns use the updated settings. A turn already running may continue with its previous settings."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
    </div>
  ));
}
