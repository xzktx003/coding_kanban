import { useAttentionStorageSync } from "./hooks/useSessionReadReceipt";
import { useComposerViewport } from "./components/codex/composer/v2/useComposerViewport";
import { startCodexAccessRuntimeSync } from "./stores/useCodexAccessStore";
import { startFollowupSettingsSync } from "./stores/useFollowupSettingsStore";
import { startAgentSettingsSync } from "./stores/useAgentSettingsStore";
import { startConfigStoreSync } from "./components/codex/stores/useConfigStore";
import { startConversationFormUnloadGuard } from "./components/codex/composer/conversationFormDrafts";
import { startComposerDraftUnloadGuard } from "./components/codex/composer/v2/drafts";
import { startCodexOperationScopeSync } from "./services/codexOperationScope";
import { startThreadModelPersistenceEvents } from "./stores/useThreadModelStore";
import { startBrowserSleepVisibilitySync } from "./browser-sleep";
import { useEffect } from "react";

export default function SessionWorkbenchEffects() {
  useComposerViewport();
  useAttentionStorageSync();
  useEffect(() => {
    const stops = [
      startCodexAccessRuntimeSync(),
      startFollowupSettingsSync(),
      startAgentSettingsSync(),
      startConfigStoreSync(),
      startConversationFormUnloadGuard(),
      startComposerDraftUnloadGuard(),
      startCodexOperationScopeSync(),
      startThreadModelPersistenceEvents(),
      startBrowserSleepVisibilitySync(),
    ];
    return () => stops.reverse().forEach((stop) => stop());
  }, []);
  return null;
}
