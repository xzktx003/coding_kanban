import { useThreadModelStore } from "@session/stores/useThreadModelStore";

const LABELS = {
  friendly: "亲和友善",
  pragmatic: "务实",
  none: "无",
} as const;

/** Plugin localConversation.personalityChanged. Kept out of the protocol event cache. */
export function PersonalityNotice({ threadId }: { threadId: string }) {
  const notice = useThreadModelStore(
    (state) => state.threads[threadId]?.personalityNotice,
  );
  if (!notice) return null;
  const label = LABELS[notice.personality] ?? notice.personality;
  return (
    <p className="session-personality-notice" role="status">
      已切换至{label}个性
    </p>
  );
}
