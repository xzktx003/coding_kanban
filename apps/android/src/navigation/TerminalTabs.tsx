import React, { useCallback } from "react";
import { Text } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { useSessionsStore } from "../state/sessions.store";
import { colors } from "../theme";
import { BoardScreen } from "../screens/terminal/BoardScreen";
import { ActivityScreen } from "../screens/terminal/ActivityScreen";
import { SessionScreen } from "../screens/terminal/SessionScreen";
import { ProjectsScreen } from "../screens/terminal/ProjectsScreen";

const Tab = createBottomTabNavigator();

function useOpenSession() {
  const navigation = useNavigation();
  const setActiveSession = useSessionsStore((s) => s.setActiveSession);
  return useCallback(
    (session: AgentSessionRecord) => {
      setActiveSession(session.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigation as any).navigate("Session");
    },
    [navigation, setActiveSession],
  );
}

function TabIcon({ glyph }: { glyph: string }) {
  return <Text style={{ fontSize: 18, color: colors.textSecondary }}>{glyph}</Text>;
}

export function TerminalTabs() {
  const openSession = useOpenSession();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bgElevated, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tab.Screen
        name="Board"
        options={{ tabBarLabel: "看板", tabBarIcon: () => <TabIcon glyph="▦" /> }}
      >
        {() => <BoardScreen onOpenSession={openSession} />}
      </Tab.Screen>
      <Tab.Screen
        name="Activity"
        options={{ tabBarLabel: "活动", tabBarIcon: () => <TabIcon glyph="◴" /> }}
      >
        {() => <ActivityScreen onOpenSession={openSession} />}
      </Tab.Screen>
      <Tab.Screen
        name="Session"
        options={{ tabBarLabel: "当前会话", tabBarIcon: () => <TabIcon glyph="⌁" /> }}
      >
        {() => <SessionScreen />}
      </Tab.Screen>
      <Tab.Screen
        name="Projects"
        options={{ tabBarLabel: "项目/文件", tabBarIcon: () => <TabIcon glyph="▤" /> }}
      >
        {() => <ProjectsScreen onOpenSession={openSession} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
