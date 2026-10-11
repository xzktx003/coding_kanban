import { useState } from "react";
import { useCodexStore } from "../stores/useCodexStore";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { sessionTabSelect } from "@session/stores/sessionTabSelect";
import { ComposerSheet } from "./v2/ComposerSheet";

export function SearchChatsSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const cards = useAgentCenterStore((state) => state.cards);
  const threads = useCodexStore((state) => state.threads);
  const names = useSessionNameStore((state) => state.names);
  const needle = query.trim().toLowerCase();
  const rows = cards
    .filter((card) => card.kind === "codex")
    .map((card) => {
      const thread = threads.find((item) => item.id === card.id);
      const title =
        names[`codex:${card.id}`] ||
        thread?.name ||
        thread?.preview ||
        card.preview ||
        card.id;
      const haystack = [title, thread?.name, thread?.preview, card.preview]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return { card, title, haystack };
    })
    .filter((row) => !needle || row.haystack.includes(needle));
  return (
    <ComposerSheet
      title="切换聊天…"
      description="搜索并切换到聊天"
      onClose={onClose}
    >
      <input
        aria-label="搜索并切换到聊天"
        placeholder="搜索并切换到聊天…"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      {rows.length === 0 ? (
        <p role="status">没有匹配的聊天</p>
      ) : (
        <div role="listbox" aria-label="聊天">
          {rows.map((row) => (
            <button
              key={row.card.id}
              type="button"
              role="option"
              onClick={() => {
                void sessionTabSelect(row.card);
                onClose();
              }}
            >
              {row.title}
            </button>
          ))}
        </div>
      )}
    </ComposerSheet>
  );
}
