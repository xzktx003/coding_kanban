import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";

export type WorkbenchMode = "terminal" | "session";

export function ModeSwitch({
  mode,
  onSwitch,
  terminalLabel,
  sessionLabel,
}: {
  mode: WorkbenchMode;
  onSwitch: (mode: WorkbenchMode) => void;
  terminalLabel: string;
  sessionLabel: string;
}) {
  return (
    <View style={styles.wrap}>
      {(
        [
          { id: "terminal", label: terminalLabel },
          { id: "session", label: sessionLabel },
        ] as const
      ).map((item) => {
        const active = mode === item.id;
        return (
          <Pressable
            key={item.id}
            style={[styles.item, active && styles.itemActive]}
            onPress={() => onSwitch(item.id)}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    backgroundColor: colors.bgElevated,
    borderRadius: radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  item: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  itemActive: { backgroundColor: colors.accent },
  label: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  labelActive: { color: colors.onAccent },
});
