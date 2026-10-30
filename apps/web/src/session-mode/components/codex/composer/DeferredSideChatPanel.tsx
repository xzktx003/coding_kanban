import { lazy, Suspense, useSyncExternalStore } from "react";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import { planSidePanel } from "@session/features/thread-workflows/planSidePanel";
import { OptionalSessionPanel } from "@session/components/layout/OptionalSessionPanel";

const Contents = lazy(() =>
  import("./SideChatPanel").then((module) => ({
    default: module.SideChatPanel,
  })),
);
const hasPlan = () => !!planSidePanel.get();

/** Observe the lightweight intents without importing a second transcript at startup. */
export function DeferredSideChatPanel() {
  const chat = useSideChatStore((s) => !!s.chat);
  const plan = useSyncExternalStore(planSidePanel.subscribe, hasPlan, hasPlan);
  if (!chat && !plan) return null;
  return (
    <OptionalSessionPanel
      label="侧边面板"
      onClose={() => {
        useSideChatStore.getState().close();
        planSidePanel.close();
      }}
    >
      <Suspense fallback={<div role="status">正在加载侧边面板…</div>}>
        <Contents />
      </Suspense>
    </OptionalSessionPanel>
  );
}
