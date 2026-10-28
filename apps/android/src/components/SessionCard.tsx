import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import {
  getAttentionGroup,
  getStateLabel,
} from "../lib/sessionGroups";
import { shortenPath, timeAgo } from "../lib/format";
import { colors, radius, spacing, typography } from "../theme";
import type { AttentionGroup } from "../lib/sessionGroups";

const groupColors: Record<AttentionGroup, string> = {
  response: colors.response,
  review: colors.review,
  executing: colors.executing,
  ready: colors.ready,
};

function getSummary(session: AgentSessionRecord): string {
  if (session.lastAgentMessageSummary) return session.lastAgentMessageSummary;
  if (session.lastUserMessageSummary) return session.lastUserMessageSummary;
  const preview = session.outputPreview?.split(/\r?\n/).filter(Boolean).slice(-1)[0];
  return preview ?? "暂无摘要，进入当前会话查看详情。";
}

function terminalPreviewLines(session: AgentSessionRecord, max = 3): string[] {
  const lines = (session.outputPreview ?? "").split(/\r?\n/).filter(Boolean);
  return lines.slice(-max);
}

export function SessionCard({
  session,
  onOpen,
}: {
  session: AgentSessionRecord;
  onOpen: (session: AgentSessionRecord) => void;
}) {
  const group = getAttentionGroup(session);
  const color = groupColors[group];
  const summary = getSummary(session);
  const previewLines = terminalPreviewLines(session);
  const hasGit = Boolean(session.projectName || session.gitBranch);
  const hasGitChanges = Boolean(session.gitChangedFiles);
  const recent = timeAgo(
    Math.max(
      Date.parse(session.lastOutputAt ?? ""),
      Date.parse(session.lastHeartbeatAt ?? ""),
      Date.parse(session.lastRefreshedAt ?? ""),
    ) || undefined,
  );

  return (
    <Pressable onPress={() => onOpen(session)} style={styles.card}>
      <View style={[styles.accent, { backgroundColor: color }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.title} numberOfLines={1}>
            {session.displayName}
          </Text>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>{getStateLabel(session)}</Text>
          </View>
        </View>

        <Text style={styles.summary} numberOfLines={2}>
          {summary}
        </Text>

        {hasGit && (
          <View style={styles.gitRow}>
            <Text style={styles.gitText} numberOfLines={1}>
              ▰ {session.projectName ?? shortenPath(session.workingDirectory)}
              {session.gitBranch ? ` · ${session.gitBranch}` : ""}
            </Text>
            {hasGitChanges ? (
              <Text style={styles.gitChanges}>
                {session.gitChangedFiles} 文件 +{session.gitAddedLines ?? 0} -{session.gitDeletedLines ?? 0}
              </Text>
            ) : session.gitBranch ? (
              <Text style={styles.gitClean}>✓ 干净</Text>
            ) : null}
          </View>
        )}

        {previewLines.length > 0 && (
          <View style={styles.terminalPreview}>
            <Text style={styles.terminalPreviewLabel}>终端预览</Text>
            <Text style={styles.terminalPreviewCode} numberOfLines={3}>
              {previewLines.join("\n")}
            </Text>
          </View>
        )}

        <View style={styles.metaRow}>
          <Text style={styles.metaText} numberOfLines={1}>
            {session.projectName ?? shortenPath(session.workingDirectory)}
          </Text>
          <Text style={styles.metaText}>{session.agentKind}</Text>
          <Text style={styles.metaText}>{recent}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: "hidden",
  },
  accent: { width: 3, borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md },
  cardBody: { flex: 1, paddingLeft: spacing.sm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { ...typography.h3, flex: 1, marginRight: spacing.sm },
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: "transparent",
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  summary: { ...typography.body, marginTop: spacing.xs, color: colors.textSecondary },
  gitRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
  gitText: { flex: 1, ...typography.caption, color: colors.textSecondary },
  gitChanges: { ...typography.caption, color: colors.warning },
  gitClean: { ...typography.caption, color: colors.success },
  terminalPreview: {
    marginTop: spacing.sm,
    backgroundColor: colors.terminalBg,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.terminalBorder,
  },
  terminalPreviewLabel: { ...typography.caption, color: colors.textMuted },
  terminalPreviewCode: { ...typography.mono, marginTop: 2 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  metaText: { ...typography.caption, color: colors.textMuted, flexShrink: 1, marginRight: spacing.sm },
});
