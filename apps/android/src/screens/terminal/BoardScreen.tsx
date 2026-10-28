import React, { useCallback, useEffect, useMemo } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { getAttentionGroup } from "../../lib/sessionGroups";
import { useI18n } from "../../i18n";
import { useSessionsStore } from "../../state/sessions.store";
import { attentionGroups, sortSessionsByAttention } from "../../lib/sessionGroups";
import { AttentionGroupSection } from "../../components/AttentionGroupSection";
import { colors, spacing, typography } from "../../theme";

export function BoardScreen({ onOpenSession }: { onOpenSession: (s: AgentSessionRecord) => void }) {
  const { t } = useI18n("zh");
  const sessions = useSessionsStore((s) => s.sessions);
  const loading = useSessionsStore((s) => s.loading);
  const error = useSessionsStore((s) => s.error);
  const load = useSessionsStore((s) => s.load);
  const refresh = useSessionsStore((s) => s.refresh);

  useEffect(() => {
    if (sessions.length === 0) void load();
  }, [load, sessions.length]);

  const visible = useMemo(() => sessions.filter((s) => !s.hidden), [sessions]);
  const sorted = useMemo(() => sortSessionsByAttention(visible), [visible]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void refresh()} />
      }
    >
      <View style={{ padding: spacing.lg }}>
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.caption, { color: colors.textMuted, letterSpacing: 1 }]}>
            {t("attentionQueue")}
          </Text>
          <Text style={typography.h1}>{t("boardTitle")}</Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {visible.length} 个会话
          </Text>
        </View>

        {error && (
          <Text style={{ color: colors.danger, marginBottom: spacing.md }}>
            {error}
          </Text>
        )}

        {loading && sorted.length === 0 ? (
          <Text style={{ ...typography.bodySecondary, color: colors.textMuted }}>
            {t("loadingSessions")}
          </Text>
        ) : sorted.length === 0 ? (
          <Text style={{ ...typography.bodySecondary, color: colors.textMuted }}>
            {t("emptySessions")}
          </Text>
        ) : (
          attentionGroups.map((group) => (
            <AttentionGroupSection
              key={group.id}
              group={group}
              sessions={sorted.filter((s) => getAttentionGroup(s) === group.id)}
              onOpenSession={onOpenSession}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}
