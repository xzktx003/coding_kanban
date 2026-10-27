import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NativeNotificationCard } from "../native-notifications/NativeNotificationCard";
import { mcpAuthLabels } from "./messages";
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
