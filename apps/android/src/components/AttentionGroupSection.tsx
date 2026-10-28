import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { colors, radius, spacing, typography } from "../theme";
import { SessionCard } from "./SessionCard";
import type { MobileAttentionGroupDefinition } from "../lib/sessionGroups";

export function AttentionGroupSection({
  group,
  sessions,
  onOpenSession,
}: {
  group: MobileAttentionGroupDefinition;
  sessions: AgentSessionRecord[];
  onOpenSession: (session: AgentSessionRecord) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (sessions.length === 0) return null;

  const accent =
    group.id === "response"
      ? colors.response
      : group.id === "review"
        ? colors.review
        : group.id === "executing"
          ? colors.executing
          : colors.ready;

  return (
    <View style={styles.section}>
      <Pressable
        style={styles.header}
        onPress={() => setCollapsed((c) => !c)}
      >
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <View style={styles.headerText}>
          <Text style={styles.label}>{group.label}</Text>
          <Text style={styles.desc}>{group.description}</Text>
        </View>
        <View style={styles.count}>
          <Text style={styles.countText}>{sessions.length}</Text>
        </View>
        <Text style={styles.chevron}>{collapsed ? "▸" : "▾"}</Text>
      </Pressable>
      {!collapsed && (
        <View style={styles.list}>
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} onOpen={onOpenSession} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
  },
  dot: { width: 10, height: 10, borderRadius: radius.pill, marginRight: spacing.sm },
  headerText: { flex: 1 },
  label: { ...typography.h3, fontSize: 16 },
  desc: { ...typography.caption, color: colors.textMuted },
  count: {
    backgroundColor: colors.bgHover,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginHorizontal: spacing.sm,
  },
  countText: { ...typography.caption, fontWeight: "700", color: colors.text },
  chevron: { color: colors.textMuted, fontSize: 14 },
  list: { marginTop: spacing.sm },
});
