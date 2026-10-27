import React, { useRef } from "react";
import { createRoot } from "react-dom/client";
import "@session/lib/i18n";
import "@session/App.css";
import { ApprovalItem } from "@session/components/codex/items/ApprovalItem";
import { useApprovalStore } from "@session/components/codex/stores/useApprovalStore";
import { useSseEventBridge } from "@session/components/codex/hooks/useSseEventBridge";
import { useServerNotificationHandler } from "@session/components/codex/hooks/useServerNotificationHandler";
import { TooltipProvider } from "@session/components/ui/tooltip";

function Fixture() {
  const onNotification = useServerNotificationHandler(
    {
      isCodexThreadActiveRef: useRef(true),
      taskCompleteBeepModeRef: useRef("never"),
      preventSleepDuringTasksRef: useRef(false),
    },
    async () => {},
  );
  useSseEventBridge({
    enabled: true,
    onApproval: useApprovalStore.getState().addApproval,
    onUserInputRequest: () => {
      throw new Error("Unexpected question");
    },
    onPermissionsRequest: () => {
      throw new Error("Unexpected permissions request");
    },
    onElicitationRequest: () => {
      throw new Error("Unexpected elicitation");
    },
    onNotification,
  });
  const pending = useApprovalStore((state) => state.pendingApprovals);
  (window as any).approvalFixture = { pending };
  return (
    <TooltipProvider>
      <main
        className="session-mode codex-presentation"
        style={{
          width: "100%",
          maxWidth: 760,
          boxSizing: "border-box",
          minWidth: 0,
          margin: "40px auto",
          padding: 24,
        }}
      >
        <h1>Private native approval acceptance</h1>
        <ApprovalItem />
        <output data-testid="pending-count">{pending.length}</output>
      </main>
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
