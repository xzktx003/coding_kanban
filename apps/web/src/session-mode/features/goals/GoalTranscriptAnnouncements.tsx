import { memo } from "react";
import { UserMessageItem } from "@session/components/codex/items/UserMessageItem";
import type { GoalAnnouncement } from "./goalTranscript";

/** Reuse the native user bubble, but supply no editable/native-turn identity. */
export const GoalTranscriptAnnouncements = memo(
  function GoalTranscriptAnnouncements({
    announcements,
    placement = "after",
  }: {
    announcements?: readonly GoalAnnouncement[];
    placement?: "before" | "after";
  }) {
    return announcements?.map((entry) => (
      <div
        key={entry.key}
        data-goal-announcement={entry.key}
        className={placement === "before" ? "pb-4" : "pt-4"}
      >
        <UserMessageItem
          threadId={entry.threadId}
          content={[{ type: "text", text: entry.text, text_elements: [] }]}
        />
      </div>
    ));
  },
);
