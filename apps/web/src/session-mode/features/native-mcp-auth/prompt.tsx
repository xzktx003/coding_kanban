import { nativeNotifications } from "../native-notifications/service";
import { McpReconnectNotice } from "./McpReconnectNotice";
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
