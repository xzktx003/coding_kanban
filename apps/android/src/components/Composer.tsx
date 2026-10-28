import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius, spacing, typography } from "../theme";

export function Composer({
  placeholder,
  disabled,
  onSubmit,
  footer,
}: {
  placeholder: string;
  disabled?: boolean;
  onSubmit: (text: string) => Promise<void>;
  footer?: React.ReactNode;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSubmit(text);
      setValue("");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          editable={!disabled}
          multiline
          returnKeyType="send"
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <Pressable
          style={[styles.send, (disabled || !value.trim() || sending) && styles.sendDisabled]}
          onPress={send}
          disabled={disabled || !value.trim() || sending}
        >
          <Text style={styles.sendText}>{sending ? "…" : "发送"}</Text>
        </Pressable>
      </View>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.sm,
    paddingBottom: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "flex-end" },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
  send: {
    marginLeft: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    height: 44,
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.onAccent, fontWeight: "700" },
});
