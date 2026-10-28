import React, { useCallback, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { useSessionsStore } from "../../state/sessions.store";
import { getStateLabel } from "../../lib/sessionGroups";
import {
  getTranscript,
  sendInput,
  getTaskSummary,
  type TranscriptEntry,
} from "../../api/boardApi";
import { TerminalView } from "../../components/terminal/TerminalView";
import { Composer } from "../../components/Composer";
import { FileBrowser } from "../../components/FileBrowser";
import { colors, radius, spacing, typography } from "../../theme";

export function SessionScreen() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const setActiveSession = useSessionsStore((s) => s.setActiveSession);
  const refresh = useSessionsStore((s) => s.refresh);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [changesNote, setChangesNote] = useState("");

  const visibleSessions = useMemo(() => sessions.filter((s) => !s.hidden), [sessions]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!activeSession) return Promise.reject(new Error("没有可用会话"));
      await sendInput(activeSession.id, text);
      await refresh();
    },
    [activeSession, refresh],
  );

  const openTranscript = useCallback(async () => {
    if (!activeSession) return;
    setShowTranscript(true);
    try {
      setTranscript(await getTranscript(activeSession.id));
    } catch {
      setTranscript([]);
    }
  }, [activeSession]);

  const openChanges = useCallback(async () => {
    if (!activeSession) return;
    setShowChanges(true);
    try {
      const summary = await getTaskSummary(activeSession.id);
      setChangesNote(JSON.stringify(summary, null, 2));
    } catch {
      setChangesNote("未获取到任务摘要");
    }
  }, [activeSession]);

  if (!activeSession) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>{ "没有可用会话" }</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Session switcher header */}
      <View style={styles.header}>
        <Pressable style={styles.switcher} onPress={() => setPickerOpen(true)}>
          <Text style={styles.switcherLabel}>{("当前会话")}</Text>
          <Text style={styles.switcherName} numberOfLines={1}>
            {activeSession.displayName}
          </Text>
          <Text style={styles.switcherState}>{getStateLabel(activeSession)}</Text>
        </Pressable>
        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={() => void openTranscript()}>
            <Text style={styles.actionText}>记录</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => void openChanges()}>
            <Text style={styles.actionText}>变更</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => setShowFiles(true)}>
            <Text style={styles.actionText}>文件</Text>
          </Pressable>
        </View>
      </View>

      {/* Terminal or file browser */}
      {showFiles ? (
        <FileBrowser
          session={activeSession}
          onBack={() => setShowFiles(false)}
        />
      ) : (
        <View style={styles.terminalWrap}>
          <TerminalView
            agentSessionId={activeSession.id}
            mobileTouchMode
            interactive
          />
        </View>
      )}

      {!showFiles && (
        <Composer
          placeholder="输入任务或消息…"
          onSubmit={handleSend}
        />
      )}

      {/* Session picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>选择终端会话</Text>
              <Pressable onPress={() => setPickerOpen(false)}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {visibleSessions.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.pickerRow, s.id === activeSession.id && styles.pickerRowActive]}
                  onPress={() => {
                    setActiveSession(s.id);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerName} numberOfLines={1}>
                    {s.displayName}
                  </Text>
                  <Text style={styles.pickerState}>{getStateLabel(s)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Transcript modal */}
      <Modal visible={showTranscript} transparent animationType="slide" onRequestClose={() => setShowTranscript(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.transcriptCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>完整记录</Text>
              <Pressable onPress={() => setShowTranscript(false)}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              {transcript.length === 0 ? (
                <Text style={styles.modalEmpty}>暂无记录</Text>
              ) : (
                transcript.map((entry, i) => (
                  <View key={i} style={styles.transcriptRow}>
                    <Text style={styles.transcriptKind}>{String(entry.kind ?? "msg")}</Text>
                    <Text style={styles.transcriptText} selectable numberOfLines={4}>
                      {renderTranscriptText(entry)}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Changes modal */}
      <Modal visible={showChanges} transparent animationType="slide" onRequestClose={() => setShowChanges(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.transcriptCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>变更</Text>
              <Pressable onPress={() => setShowChanges(false)}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              <Text style={styles.modalBody} selectable>
                {changesNote}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function renderTranscriptText(entry: TranscriptEntry): string {
  const text = entry.text ?? entry.content ?? "";
  if (typeof text === "string") return text;
  try {
    return JSON.stringify(text);
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  empty: { ...typography.bodySecondary, color: colors.textMuted },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  switcher: { flex: 1 },
  switcherLabel: { ...typography.caption, color: colors.textMuted },
  switcherName: { ...typography.h3, fontSize: 16 },
  switcherState: { ...typography.caption, color: colors.accent },
  actions: { flexDirection: "row" },
  action: { marginLeft: spacing.sm, padding: spacing.sm },
  actionText: { color: colors.accent, fontWeight: "600" },
  terminalWrap: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  pickerCard: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  transcriptCard: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: "80%",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  modalTitle: { ...typography.h3 },
  close: { color: colors.textSecondary, fontSize: 18 },
  pickerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  pickerRowActive: { backgroundColor: colors.accentSoft, borderRadius: radius.sm },
  pickerName: { flex: 1, ...typography.body, marginRight: spacing.sm },
  pickerState: { ...typography.caption, color: colors.textSecondary },
  transcriptRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  transcriptKind: { ...typography.caption, color: colors.accent },
  transcriptText: { ...typography.body, marginTop: 2 },
  modalEmpty: { ...typography.bodySecondary, color: colors.textMuted },
  modalBody: { ...typography.body },
});
