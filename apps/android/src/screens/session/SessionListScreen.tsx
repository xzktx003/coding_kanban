import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { listThreads, type SessionThread } from "../../api/sessionApi";
import { timeAgo } from "../../lib/format";
import { colors, radius, spacing, typography } from "../../theme";

export function SessionListScreen() {
  const navigation = useNavigation();
  const [threads, setThreads] = useState<SessionThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listThreads();
      setThreads(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openChat = useCallback(
    (thread: SessionThread) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigation as any).navigate("Chat", { threadId: thread.id, title: thread.name ?? thread.preview });
    },
    [navigation],
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={threads}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} />
      }
      ListHeaderComponent={
        <View style={styles.heading}>
          <Text style={[typography.caption, { color: colors.textMuted, letterSpacing: 1 }]}>
            CHAT
          </Text>
          <Text style={typography.h1}>会话</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          {loading ? "正在加载…" : error ?? "暂无会话"}
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => openChat(item)}>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name ?? item.preview ?? "未命名会话"}
            </Text>
            <Text style={styles.rowPreview} numberOfLines={1}>
              {item.preview}
            </Text>
          </View>
          <Text style={styles.time}>{timeAgo(item.updatedAt * 1000)}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  heading: { padding: spacing.lg, paddingBottom: spacing.sm },
  empty: { ...typography.bodySecondary, color: colors.textMuted, textAlign: "center", padding: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  rowBody: { flex: 1, marginRight: spacing.sm },
  rowTitle: { ...typography.body, fontWeight: "600" },
  rowPreview: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.caption, color: colors.textMuted },
});
