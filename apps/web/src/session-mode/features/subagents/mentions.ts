import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentMention } from "@agent-orchestrator/shared";
export const useAgentMentionDrafts = create<{
  drafts: Record<string, AgentMention[]>;
}>()(
  persist(() => ({ drafts: {} }), {
    name: "kanban.session.agent-mentions",
    version: 1,
  }),
);
export const mentionDrafts = {
  read: (owner: string) => useAgentMentionDrafts.getState().drafts[owner] ?? [],
  add: (owner: string, mention: AgentMention) =>
    useAgentMentionDrafts.setState((s) => ({
      drafts: {
        ...s.drafts,
        [owner]: [
          ...(s.drafts[owner] ?? []).filter((m) => m.path !== mention.path),
          mention,
        ],
      },
    })),
  clear: (owner: string, sent: AgentMention[]) =>
    useAgentMentionDrafts.setState((s) => ({
      drafts: {
        ...s.drafts,
        [owner]: (s.drafts[owner] ?? []).filter((m) => !sent.includes(m)),
      },
    })),
  move: (from: string, to: string) => {
    const sent = mentionDrafts.read(from);
    for (const m of sent) mentionDrafts.add(to, m);
    mentionDrafts.clear(from, sent);
  },
};
