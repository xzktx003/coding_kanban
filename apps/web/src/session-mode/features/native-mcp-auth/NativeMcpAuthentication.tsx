import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { nativeNotifications } from "../native-notifications/service";
import { NativeNotificationCard } from "../native-notifications/NativeNotificationCard";
import { mcpAuthLabels } from "./messages";
import { startMcpAuthentication } from "./service";
export function McpReconnectNotice({
  serverName,
  onReconnect,
  onClose,
}: {
  serverName: string;
  onReconnect: () => Promise<void>;
  onClose: () => void;
}) {
  const { i18n } = useTranslation(),
    labels = mcpAuthLabels(i18n.language ?? "zh", serverName),
    [loading, setLoading] = useState(false);
  return (
    <NativeNotificationCard
      level="warning"
      title={labels.title}
      description={labels.description}
      onClose={onClose}
      primaryAction={{
        label: labels.reconnect,
        loading,
        onClick: async () => {
          setLoading(true);
          try {
            await onReconnect();
          } finally {
            setLoading(false);
          }
        },
      }}
    />
  );
}
export function showMcpPrompt(
  name: string,
  reconnect: () => Promise<void>,
  dismiss: () => void,
  remove: () => void,
) {
  return nativeNotifications.custom({
    level: "warning",
    duration: 0,
    id: "mcp-reauthentication-required:prompt:" + JSON.stringify(name),
    onUserDismiss: dismiss,
    onRemove: remove,
    content: ({ close }) => (
      <McpReconnectNotice
        serverName={name}
        onReconnect={reconnect}
        onClose={() => {
          dismiss();
          close();
        }}
      />
    ),
  });
}
export function NativeMcpAuthentication() {
  useEffect(() => startMcpAuthentication(), []);
  return null;
}
