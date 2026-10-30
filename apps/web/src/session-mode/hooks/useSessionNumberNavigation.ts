import { useEffect } from "react";
import { listenInSessionMode } from "@session/session-dom";
import { numberNavigationIntent } from "@session/services/sessionKeyboardShortcuts";
import {
  agentCardKey,
  useAgentCenterStore,
} from "@session/stores/useAgentCenterStore";
import {
  splitGroups,
  useSessionSplitStore,
} from "@session/stores/useSessionSplitStore";
import {
  canSelectSessionTab,
  sessionTabSelect,
} from "@session/stores/sessionTabSelect";

/** Explicit navigation reuses the tab selector, including project/input target
 * synchronization, instead of changing only the visual active marker. */
export function useSessionNumberNavigation() {
  useEffect(
    () =>
      listenInSessionMode(window, "keydown", (event) => {
        const intent = numberNavigationIntent(event);
        if (
          !intent ||
          !canSelectSessionTab() ||
          (event.target instanceof Element &&
            event.target.closest('[role="dialog"], [role="alertdialog"]')) ||
          document.querySelector(
            '.session-mode [role="dialog"], .session-mode [role="alertdialog"]',
          )
        )
          return;
        const cards = useAgentCenterStore.getState().cards;
        const split = useSessionSplitStore.getState();
        const key =
          intent.target === "tabs"
            ? splitGroups(split.tree).find(
                (group) => group.id === split.activeGroupId,
              )?.keys[intent.index]
            : undefined;
        const card =
          intent.target === "chats"
            ? cards[intent.index]
            : cards.find((card) => agentCardKey(card) === key);
        if (!card) return;
        event.preventDefault();
        void sessionTabSelect(card);
      }),
    [],
  );
}
