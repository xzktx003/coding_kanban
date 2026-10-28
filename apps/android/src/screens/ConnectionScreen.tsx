import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useServerStore } from "../state/server.store";
import { validateServerUrl } from "../core/config";
import { colors, radius, spacing, typography } from "../theme";

export function ConnectionScreen({ onDone }: { onDone: () => void }) {
  const { url, init, connect } = useServerStore();
  const [value, setValue] = useState(url);
  const [status, setStatus] = useState<"idle" | "connecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    setValue((current) => current || url);
  }, [url]);

  const handleConnect = async () => {
    const validation = validateServerUrl(value);
    if (validation) {
      setStatus("error");
      setError(validation === "EMPTY" ? "地址不能为空" : "地址格式不正确，请检查后重试");
      return;
    }
    setStatus("connecting");
    setError(null);
    const ok = await connect(value);
    if (ok) {
      setStatus("idle");
      onDone();
    } else {
      setStatus("error");
      setError("无法连接到服务器");
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.brand}>Coding Kanban</Text>
        <Text style={styles.tagline}>手机端工作台</Text>

        <Text style={styles.label}>服务器地址</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="http://10.30.0.24:3000"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={() => void handleConnect()}
        />
        <Text style={styles.hint}>
          输入 Coding Kanban 后端的局域网地址（含端口）
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.connectBtn, status === "connecting" && styles.connectDisabled]}
          onPress={() => void handleConnect()}
          disabled={status === "connecting"}
        >
          <Text style={styles.connectText}>
            {status === "connecting" ? "连接中…" : "连接"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: "center", padding: spacing.xl },
  brand: { ...typography.h1, textAlign: "center", color: colors.accent },
  tagline: { ...typography.bodySecondary, textAlign: "center", marginBottom: spacing.xxl },
  label: { ...typography.bodySecondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: spacing.md,
    fontSize: 15,
  },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  error: { color: colors.danger, marginTop: spacing.sm },
  connectBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  connectDisabled: { opacity: 0.5 },
  connectText: { color: colors.onAccent, fontWeight: "700", fontSize: 16 },
});
