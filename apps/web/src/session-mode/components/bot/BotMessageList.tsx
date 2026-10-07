import { useSessionInteractionVisible } from "@session/session-dom";
import { useEffect, useRef, useMemo, useState } from "react";
import { AcpToolCall } from "@session/components/acp/AcpToolCall";
import { Button } from "@session/components/ui/button";
import type { Bot } from "@session/services/apiAdapt/bots";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useBotUiStore } from "@session/stores/useBotUiStore";
import { BotAvatar } from "./BotAvatar";
import { useBotTimeline } from "./useBotTimeline";

/** The conversation, as chat bubbles: you on the right, the bot on the left. */
export function BotMessageList({ bot }: { bot: Bot }) {
  const { entries: liveEntries, connecting } = useAcpStore();
  const activeSessionId = useBotUiStore((state) => state.sessionByBot[bot.id]);
  const { sections, error, retry } = useBotTimeline(bot.id, activeSessionId);
  const entries = useMemo(() => {
    const result = sections.flatMap((section) =>
      section.sessionId === activeSessionId ? liveEntries : section.entries,
    );
    if (!sections.some((section) => section.sessionId === activeSessionId))
      result.push(...liveEntries);
    return result;
  }, [sections, liveEntries, activeSessionId]);
  // Per-bot, so a turn running in another conversation does not show this bot
  // as typing.
  const running = useBotUiStore((s) => Boolean(s.runningByBot[bot.id]));
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const visible = useSessionInteractionVisible();
  const goToLatest = () => {
    following.current = true;
    setShowLatest(false);
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  };
  useEffect(() => {
    following.current = true;
    setShowLatest(false);
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [bot.id, activeSessionId]);
  useEffect(() => {
    if (following.current) {
      if (visible)
        bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    } else setShowLatest(true);
  }, [entries, visible]);
  const readPosition = () => {
    const container = scrollRef.current;
    if (!container || !visible || container.closest("[hidden], [inert]"))
      return;
    following.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      80;
    if (following.current) setShowLatest(false);
  };

  return (
    <div className="flex min-w-0 max-w-full flex-1 min-h-0 flex-col">
      <div
        ref={scrollRef}
        data-bot-history
        onScroll={readPosition}
        className="min-w-0 max-w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-2 text-sm"
      >
        {error && (
          <div
            role="alert"
            className="flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere] text-xs text-destructive"
          >
            {error}
            <Button size="sm" variant="ghost" onClick={retry}>
              重试
            </Button>
          </div>
        )}
        {entries.length === 0 && !connecting && (
          <div className="py-10 text-center text-muted-foreground">
            <BotAvatar bot={bot} size="lg" className="mx-auto mb-2" />
            <div className="mx-auto max-w-xs line-clamp-2 [overflow-wrap:anywhere] font-medium text-foreground">
              {bot.name}
            </div>
            {bot.title && (
              <div className="mx-auto max-w-xs line-clamp-2 [overflow-wrap:anywhere] text-xs">
                {bot.title}
              </div>
            )}
            <div className="mt-2 text-xs">发送一条消息，开始对话。</div>
          </div>
        )}

        {entries.map((entry) => {
          if (entry.role === "tool") {
            return (
              <div
                key={entry.id}
                className="min-w-0 max-w-[85%] overflow-x-auto"
              >
                <AcpToolCall entry={entry} />
              </div>
            );
          }

          if (entry.role === "user") {
            return (
              <div key={entry.id} className="flex min-w-0 justify-end">
                <div className="min-w-0 max-w-[80%] [overflow-wrap:anywhere] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">
                  {entry.text}
                </div>
              </div>
            );
          }

          if (entry.role === "error") {
            return (
              <div
                key={entry.id}
                className="min-w-0 max-w-full [overflow-wrap:anywhere] px-1 py-1 text-xs text-destructive"
              >
                {entry.text}
              </div>
            );
          }

          // A thought is the bot working, not the bot talking — kept quiet so the
          // conversation still reads as a conversation.
          if (entry.role === "thought") {
            return (
              <div
                key={entry.id}
                className="min-w-0 max-w-full [overflow-wrap:anywhere] px-1 text-xs italic text-muted-foreground"
              >
                {entry.text}
              </div>
            );
          }

          return (
            <div key={entry.id} className="flex min-w-0 items-end gap-2">
              <BotAvatar bot={bot} size="sm" />
              <div className="min-w-0 max-w-[80%] [overflow-wrap:anywhere] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-muted px-3 py-2">
                {entry.text}
              </div>
            </div>
          );
        })}

        {(connecting || running) && (
          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <BotAvatar bot={bot} size="sm" />
            {connecting ? `正在连接${bot.name}…` : "正在处理…"}
          </div>
        )}

        <div ref={bottomRef} data-bot-latest />
      </div>
      {showLatest && (
        <div className="flex shrink-0 justify-center py-1">
          <Button size="sm" variant="outline" onClick={goToLatest}>
            回到最新
          </Button>
        </div>
      )}
    </div>
  );
}
