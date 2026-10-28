import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import {
  interruptTurn,
  listTurns,
  startTurn,
  subscribeToEvents,
  type SessionItem,
  type SessionTurn,
} from "../../api/sessionApi";
import { Composer } from "../../components/Composer";
import { colors, radius, spacing, typography } from "../../theme";

type ChatParams = { threadId: string; title: string };

export function ChatScreen() {
  const route = useRoute<RouteProp<Record<string, ChatParams>, string>>();
  const { threadId, title } = route.params;
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTurns(threadId, { limit: 60, itemsView: "full" });
      // turns come newest first; reverse to chronological.
      setTurns([...(res.data ?? [])].reverse());
    } catch {
      setTurns([]);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const stop = subscribeToEvents((_name, data) => {
      try {
        const parsed = JSON.parse(data);
        // Reload turns when a turn-related event arrives.
        if (parsed && typeof parsed === "object") {
          void load();
        }
      } catch {
        // ignore
      }
    });
    return stop;
  }, [load]);

  const handleSend = useCallback(
    async (text: string) => {
      setSending(true);
      try {
        await startTurn(threadId, text);
        setTimeout(() => void load(), 800);
      } finally {
        setSending(false);
      }
    },
    [threadId, load],
  );

  const handleInterrupt = useCallback(() => {
    void interruptTurn(threadId);
  }, [threadId]);

  const items = turns.flatMap((turn) => turn.items);
  const active = turns.some((t) => t.status === "in_progress" || t.status === "running");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {active && (
          <Pressable style={styles.interrupt} onPress={handleInterrupt}>
            <Text style={styles.interruptText}>停止</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {loading && items.length === 0 ? (
          <Text style={styles.empty}>正在加载对话…</Text>
        ) : items.length === 0 ? (
          <Text style={styles.empty}>暂无消息，发送第一条消息开始。</Text>
        ) : (
          items.map((item) => <MessageBubble key={item.id ?? `${item.type}-${Math.random()}`} item={item} />)
        )}
      </ScrollView>

      <Composer placeholder="输入消息…" onSubmit={handleSend} />
    </View>
  );
}

function MessageBubble({ item }: { item: SessionItem }) {
  const isUser = item.type === "userMessage";
  const isAgent = item.type === "agentMessage";
  const text =
    item.type === "userMessage"
      ? (item.content ?? []).map((c) => c.text ?? "").filter(Boolean).join("\n")
      : isAgent
        ? item.text ?? ""
        : item.type === "plan"
          ? item.text ?? ""
          : item.type === "commandExecution"
            ? `$ ${item.command ?? ""}`
            : item.summary?.join("\n") ?? item.name ?? item.type;

  if (item.type === "commandExecution" || item.type === "fileChange" || item.type === "reasoning") {
    return (
      <View style={styles.toolBlock}>
        <Text style={styles.toolTag}>
          {item.type === "commandExecution" ? "终端" : item.type === "fileChange" ? "文件变更" : "推理"}
        </Text>
        <Text style={styles.toolText} selectable numberOfLines={6}>
          {text || (item.changes?.length ? `${item.changes.length} 处变更` : "")}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
      <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]} selectable>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  title: { ...typography.h3, flex: 1, marginRight: spacing.sm },
  interrupt: { backgroundColor: colors.danger, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  interruptText: { color: colors.onAccent, fontWeight: "700", fontSize: 12 },
  messages: { padding: spacing.lg },
  empty: { ...typography.bodySecondary, color: colors.textMuted, textAlign: "center", padding: spacing.xl },
  bubble: { marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.lg, maxWidth: "92%" },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: colors.accent },
  bubbleAgent: { alignSelf: "flex-start", backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.borderSoft },
  bubbleText: { ...typography.body, color: colors.text },
  bubbleTextUser: { color: colors.onAccent },
  toolBlock: {
    marginBottom: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.terminalBorder,
    padding: spacing.md,
  },
  toolTag: { ...typography.caption, color: colors.accent, marginBottom: spacing.xs },
  toolText: { ...typography.mono, color: colors.textSecondary },
});
