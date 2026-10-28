import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { useSessionsStore } from "../../state/sessions.store";
import { getStateLabel } from "../../lib/sessionGroups";
import { shortenPath } from "../../lib/format";
import { FileBrowser } from "../../components/FileBrowser";
import { colors, radius, spacing, typography } from "../../theme";

export function ProjectsScreen({ onOpenSession }: { onOpenSession: (s: AgentSessionRecord) => void }) {
  const sessions = useSessionsStore((s) => s.sessions);
  const loading = useSessionsStore((s) => s.loading);
  const load = useSessionsStore((s) => s.load);
  const [fileSession, setFileSession] = useState<AgentSessionRecord | null>(null);

  useEffect(() => {
    if (sessions.length === 0) void load();
  }, [load, sessions.length]);

  const projectGroups = useMemo(() => {
    const groups = new Map<string, AgentSessionRecord[]>();
    for (const session of sessions.filter((s) => !s.hidden)) {
      const location =
        session.repositoryRoot ?? session.workingDirectory ?? session.projectName ?? "未归属项目";
      const host = session.sshTarget
        ? `${session.sshTarget.username ?? ""}@${session.sshTarget.host}:${session.sshTarget.port ?? 22}`
        : "local";
      const key = `${host}:${location}`;
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    return [...groups.entries()];
  }, [sessions]);

  if (fileSession) {
    return <FileBrowser session={fileSession} onBack={() => setFileSession(null)} />;
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={styles.heading}>
        <Text style={[typography.caption, { color: colors.textMuted, letterSpacing: 1 }]}>
          WORKSPACES
        </Text>
        <Text style={typography.h1}>项目与文件</Text>
      </View>

      {loading && sessions.length === 0 ? (
        <Text style={styles.empty}>正在加载…</Text>
      ) : projectGroups.length === 0 ? (
        <Text style={styles.empty}>暂无项目或文件入口。</Text>
      ) : (
        projectGroups.map(([project, projectSessions]) => {
          const first = projectSessions[0];
          return (
            <View key={project} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {first?.projectName ?? first?.repositoryRoot ?? first?.workingDirectory ?? "未归属项目"}
                  </Text>
                  <Text style={styles.cardPath} numberOfLines={1}>
                    {shortenPath(first?.workingDirectory)}
                  </Text>
                </View>
                <Pressable
                  style={styles.browseBtn}
                  onPress={() => first && setFileSession(first)}
                >
                  <Text style={styles.browseText}>浏览文件</Text>
                </Pressable>
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.cardCount}>{projectSessions.length} 个会话</Text>
              </View>
              {projectSessions.map((session) => (
                <Pressable key={session.id} style={styles.row} onPress={() => onOpenSession(session)}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {session.displayName}
                  </Text>
                  <Text style={styles.rowState}>{getStateLabel(session)}</Text>
                </Pressable>
              ))}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.md },
  empty: { ...typography.bodySecondary, color: colors.textMuted, textAlign: "center", padding: spacing.xl },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start" },
  cardTitle: { ...typography.h3 },
  cardPath: { ...typography.caption, color: colors.textSecondary },
  browseBtn: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  browseText: { color: colors.onAccent, fontWeight: "700", fontSize: 12 },
  cardFooter: { marginTop: spacing.xs },
  cardCount: { ...typography.caption, color: colors.textMuted },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    marginTop: spacing.sm,
  },
  rowName: { flex: 1, ...typography.body, marginRight: spacing.sm },
  rowState: { ...typography.caption, color: colors.textSecondary },
});
