// Original mcp.reauthenticationRequired messages.
const messages = {
  en: {
    title: "Reconnect MCP server “{serverName}”",
    description:
      "Authentication expired. Reconnect to keep using this MCP server",
    reconnect: "Reconnect",
    startError: "Couldn’t connect to MCP server “{serverName}”. Try again.",
    completionError:
      "Authentication for MCP server “{serverName}” was not completed",
  },
  zh: {
    title: "重新连接 MCP 服务器“{serverName}”",
    description: "身份验证已过期。请重新连接以继续使用此 MCP 服务器",
    reconnect: "重新连接",
    startError: "无法连接到 MCP 服务器“{serverName}”。请重试。",
    completionError: "MCP 服务器“{serverName}”的身份验证未完成",
  },
  ja: {
    title: "MCP サーバー「{serverName}」に再接続",
    description:
      "認証の有効期限が切れました。この MCP サーバーを引き続き使用するには再接続してください",
    reconnect: "再接続",
    startError:
      "MCP サーバー「{serverName}」に接続できませんでした。もう一度お試しください。",
    completionError: "MCP サーバー「{serverName}」の認証が完了しませんでした",
  },
  fr: {
    title: "Reconnecter le serveur MCP « {serverName} »",
    description:
      "Authentification expirée. Reconnectez-vous pour continuer à utiliser ce serveur MCP",
    reconnect: "Se reconnecter",
    startError:
      "Impossible de se connecter au serveur MCP « {serverName} ». Réessayez.",
    completionError:
      "L’authentification auprès du serveur MCP « {serverName} » n’a pas été terminée",
  },
} as const;
export function mcpAuthLabels(locale: string, name: string) {
  const language = locale.startsWith("zh")
    ? "zh"
    : locale.startsWith("ja")
      ? "ja"
      : locale.startsWith("fr")
        ? "fr"
        : "en";
  return Object.fromEntries(
    Object.entries(messages[language]).map(([key, value]) => [
      key,
      value.replace("{serverName}", name),
    ]),
  ) as Record<keyof typeof messages.en, string>;
}
