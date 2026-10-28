import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { useServerStore } from "./src/state/server.store";
import { ModeSwitch, type WorkbenchMode } from "./src/components/ModeSwitch";
import { ConnectionScreen } from "./src/screens/ConnectionScreen";
import { TerminalTabs } from "./src/navigation/TerminalTabs";
import { SessionStack } from "./src/navigation/SessionStack";
import { colors, radius, spacing, typography } from "./src/theme";

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const url = useServerStore((s) => s.url);
  const ready = useServerStore((s) => s.ready);
  const init = useServerStore((s) => s.init);
  const disconnect = useServerStore((s) => s.disconnect);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<WorkbenchMode>("terminal");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (ready) setConnected(Boolean(url));
  }, [ready, url]);

  if (!ready) {
    return <View style={styles.loading} />;
  }

  if (!connected) {
    return <ConnectionScreen onDone={() => setConnected(true)} />;
  }

  const handleDisconnect = async () => {
    await disconnect();
    setConnected(false);
    setSettingsOpen(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Coding Kanban</Text>
        <ModeSwitch
          mode={mode}
          onSwitch={setMode}
          terminalLabel="终端"
          sessionLabel="会话"
        />
        <Pressable style={styles.settingsBtn} onPress={() => setSettingsOpen(true)}>
          <Text style={styles.settingsGlyph}>⚙</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        {mode === "terminal" ? <TerminalTabs /> : <SessionStack />}
      </View>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>设置</Text>
            <Text style={styles.settingsRow}>服务器地址</Text>
            <Text style={styles.settingsValue} selectable>
              {url}
            </Text>
            <Pressable style={styles.switchBtn} onPress={() => void handleDisconnect()}>
              <Text style={styles.switchBtnText}>切换服务器</Text>
            </Pressable>
            <Pressable style={styles.closeBtn} onPress={() => setSettingsOpen(false)}>
              <Text style={styles.closeText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brand: { ...typography.h3, color: colors.accent },
  settingsBtn: { padding: spacing.sm },
  settingsGlyph: { fontSize: 18, color: colors.textSecondary },
  content: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: "center", backgroundColor: colors.overlay, padding: spacing.xl },
  settingsCard: { backgroundColor: colors.bgElevated, borderRadius: radius.lg, padding: spacing.xl },
  settingsTitle: { ...typography.h2, marginBottom: spacing.lg },
  settingsRow: { ...typography.caption, color: colors.textMuted },
  settingsValue: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  switchBtn: { backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  switchBtnText: { color: colors.onAccent, fontWeight: "700" },
  closeBtn: { marginTop: spacing.md, alignItems: "center" },
  closeText: { color: colors.textSecondary },
});
