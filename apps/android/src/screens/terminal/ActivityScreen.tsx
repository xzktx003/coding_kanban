import React, { useEffect, useMemo } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { useI18n } from "../../i18n";
import { useSessionsStore } from "../../state/sessions.store";
import { latestActivity } from "../../lib/sessionGroups";
import { timeAgo } from "../../lib/format";
import { colors, radius, spacing, typography } from "../../theme";
import { getAttentionGroup } from "../../lib/sessionGroups";

export function ActivityScreen({ onOpenSession }: { onOpenSession: (s: AgentSessionRecord) => void }) {
  const { t } = useI18n("zh");
  const sessions = useSessionsStore((s) => s.sessions);
  const loading = useSessionsStore((s) => s.loading);
  const load = useSessionsStore((s) => s.load);
  const refresh = useSessionsStore((s) => s.refresh);

  useEffect(() => {
    if (sessions.length === 0) void load();
  }, [load, sessions.length]);

  const activity = useMemo(
    () =>
      sessions
        .filter((s) => !s.hidden)
        .sort((a, b) => latestActivity(b) - latestActivity(a)),
    [sessions],
  );

  const dotColor = (s: AgentSessionRecord): string => {
    const g = getAttentionGroup(s);
    return g === "response"
      ? colors.response
      : g === "review"
        ? colors.review
        : g === "executing"
          ? colors.executing
          : colors.ready;
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={activity}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void refresh()} />
      }
      ListHeaderComponent={
        <View style={styles.heading}>
          <Text style={[typography.caption, { color: colors.textMuted, letterSpacing: 1 }]}>
            RECENT UPDATES
          </Text>
          <Text style={typography.h1}>{t("tabActivity")}</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>{loading ? t("loadingSessions") : t("noActivity")}</Text>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => onOpenSession(item)}>
          <View style={[styles.dot, { backgroundColor: dotColor(item) }]} />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.displayName}
            </Text>
            <Text style={styles.rowSummary} numberOfLines={1}>
              {item.lastAgentMessageSummary ?? item.lastUserMessageSummary ?? ""}
            </Text>
          </View>
          <Text style={styles.time}>{timeAgo(latestActivity(item))}</Text>
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
  dot: { width: 10, height: 10, borderRadius: radius.pill, marginRight: spacing.md },
  rowBody: { flex: 1, marginRight: spacing.sm },
  rowTitle: { ...typography.body, fontWeight: "600" },
  rowSummary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.caption, color: colors.textMuted },
});
