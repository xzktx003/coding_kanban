import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ThreadItem } from "@session/bindings/v2";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import { openThreadLink } from "@session/features/thread-workflows/threadLinkService";
import { useSessionTabActions } from "@session/hooks/useSessionTabs";
import { nativeDynamicToolTarget } from "../presentation/nativeDynamicToolTarget";
import { NativeDynamicToolIcon } from "../presentation/NativeDynamicToolIcon";
import { nativeDynamicToolLabel } from "../presentation/nativeDynamicToolSemantics";
import { NativeCadencedShimmer } from "../presentation/NativeCadencedShimmer";
import { NativeToolDisclosure } from "./NativeToolDisclosure";
type DynamicItem = Extract<ThreadItem, { type: "dynamicToolCall" }>;
/** Registry tools expose a compact activity label and deliberate target navigation. */
export function NativeDynamicToolItem({
  item,
  running,
}: {
  item: DynamicItem;
  running: boolean;
}) {
  const { i18n } = useTranslation("thread"),
    language = i18n?.language ?? "zh",
    chinese = language.startsWith("zh"),
    { selectTab } = useSessionTabActions();
  const target = nativeDynamicToolTarget(item),
    label = nativeDynamicToolLabel(item, language);
  const content = running ? (
    <NativeCadencedShimmer>{label}</NativeCadencedShimmer>
  ) : (
    <span className="codex-native-dynamic-completed-label">{label}</span>
  );
  const local =
    target?.kind === "codex" &&
    "threadId" in target &&
    (target.hostId === undefined || target.hostId === "local")
      ? target.threadId
      : null;
  const explanation =
    target?.kind === "chatgpt"
      ? chinese
        ? "当前未提供打开此 ChatGPT 聊天的原生主机能力。"
        : "The native host capability to open this ChatGPT chat is unavailable."
      : chinese
        ? "当前未提供打开此主机聊天的原生导航能力。"
        : "The native host capability to open this chat is unavailable.";
  const summary = local ? (
    <button
      type="button"
      className="codex-native-dynamic-target"
      onClick={() => {
        void openThreadLink({ threadId: local }, selectTab).catch((error) =>
          toast.error(chinese ? "无法打开聊天" : "Could not open chat", {
            description: String(error),
          }),
        );
      }}
    >
      {content}
    </button>
  ) : target ? (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="codex-native-dynamic-target"
          aria-disabled="true"
        >
          {content}
        </button>
      </PopoverTrigger>
      <PopoverContent className="codex-file-preview codex-native-target-info w-64">
        {explanation}
      </PopoverContent>
    </Popover>
  ) : (
    content
  );
  return (
    <NativeToolDisclosure
      className={`codex-native-firstparty-tool${target ? " has-native-target" : ""}`}
      icon={<NativeDynamicToolIcon tool={item.tool} />}
      summary={summary}
    />
  );
}
