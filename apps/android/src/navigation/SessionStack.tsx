import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SessionListScreen } from "../screens/session/SessionListScreen";
import { ChatScreen } from "../screens/session/ChatScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator();

export function SessionStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgElevated },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen
        name="SessionList"
        component={SessionListScreen}
        options={{ title: "会话" }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={({ route }) => ({ title: (route.params as { title?: string })?.title ?? "会话" })}
      />
    </Stack.Navigator>
  );
}
