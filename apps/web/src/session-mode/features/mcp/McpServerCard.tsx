import { listen } from "@tauri-apps/api/event";
import { Edit, KeyRound, Loader2, Trash2 } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import type {
  McpAuthStatus,
  McpServerOauthLoginCompletedNotification,
} from "@session/bindings/v2";
import type { McpServerConfig } from "@session/components/codex/types";
import { Badge } from "@session/components/ui/badge";
import { Button } from "@session/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@session/components/ui/card";
import { Switch } from "@session/components/ui/switch";
import { useExternalUrl } from "@session/features/plugins/hooks/useExternalUrl";
import { isTauri } from "@session/hooks/runtime";
import { useIsMobile } from "@session/hooks/use-mobile";
import { openEventStream } from "@session/lib/eventStream";
import "./mcp-card.css";
import {
  mcpServerOauthLogin,
  unifiedDisableMcpServer,
  unifiedEnableMcpServer,
  unifiedRemoveMcpServer,
} from "@session/services";

const AUTH_STATUS_LABEL: Record<McpAuthStatus, string> = {
  unsupported: "No auth",
  notLoggedIn: "Not logged in",
  bearerToken: "Token",
  oAuth: "OAuth",
};

export const getServerProtocol = (
  config: McpServerConfig,
): "stdio" | "http" | "sse" => config.type ?? "stdio";

interface McpServerCardProps {
  name: string;
  config: McpServerConfig;
  loadServers: () => Promise<void>;
  setServers: Dispatch<SetStateAction<Record<string, McpServerConfig>>>;
  onEdit: (name: string, config: McpServerConfig) => void;
  authStatus?: McpAuthStatus;
  onAuthChanged?: () => void;
}

export function McpServerCard({
  name,
  config,
  loadServers,
  setServers,
  onEdit,
  authStatus,
  onAuthChanged,
}: McpServerCardProps) {
  const serverType = getServerProtocol(config);
  const isEnabled = config.enabled ?? true;
  const { openExternalUrl } = useExternalUrl();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const attempt = useRef<object | null>(null);
  const noticeId = useRef<string | number | undefined>(undefined);
  const mobile = useIsMobile();
  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  const notify = (kind: "success" | "error" | "info", message: string) => {
    noticeId.current = toast[kind](message, {
      id: noticeId.current,
      position: mobileRef.current ? "bottom-center" : "top-right",
      className: "session-mcp-notice",
    });
  };
  const onAuthChangedRef = useRef(onAuthChanged);
  onAuthChangedRef.current = onAuthChanged;
  // stdio servers run locally and never go through OAuth.
  const supportsAuth = serverType !== "stdio";
  const needsAuth = supportsAuth && authStatus === "notLoggedIn";
  const authEndpoint = "url" in config ? config.url : null;

  useEffect(() => {
    attempt.current = null;
    setIsAuthorizing(false);
    return () => {
      attempt.current = null;
      if (noticeId.current != null) toast.dismiss(noticeId.current);
      noticeId.current = undefined;
    };
  }, [name, serverType, authEndpoint]);

  useEffect(() => {
    if (authStatus && authStatus !== "notLoggedIn") {
      attempt.current = null;
      setIsAuthorizing(false);
    }
  }, [authStatus]);

  useEffect(() => {
    if (!isAuthorizing || !attempt.current) {
      return;
    }
    const capturedAttempt = attempt.current;
    let active = true;
    const notification = ({ method, params }: ServerNotification) => {
      if (!active || attempt.current !== capturedAttempt) return;
      if (method !== "mcpServer/oauthLogin/completed") {
        return;
      }
      if (!params || typeof params !== "object") return;
      const payload = params as McpServerOauthLoginCompletedNotification;
      if (
        payload.name !== name ||
        payload.threadId != null ||
        typeof payload.success !== "boolean"
      ) {
        return;
      }
      setIsAuthorizing(false);
      attempt.current = null;
      if (payload.success) {
        notify("success", `Authorized "${name}"`);
      } else {
        notify(
          "error",
          `Authorization failed: ${payload.error ?? "unknown error"}`,
        );
      }
      onAuthChangedRef.current?.();
    };
    const close = !isTauri()
      ? openEventStream({
          agents: ["codex"],
          label: "mcp-oauth",
          onEvent: (event) => {
            if (
              event.event === "codex:notification" &&
              event.payload &&
              typeof event.payload === "object"
            )
              notification(event.payload as ServerNotification);
          },
          onResync: () => {
            onAuthChangedRef.current?.();
          },
        })
      : null;
    const unlistenPromise = close
      ? null
      : listen<ServerNotification>("codex:notification", (event) =>
          notification(event.payload),
        );
    const timeout = window.setTimeout(() => {
      if (!active || attempt.current !== capturedAttempt) return;
      attempt.current = null;
      setIsAuthorizing(false);
      notify(
        "error",
        "Authorization result is still unknown. Refresh the status before retrying.",
      );
      onAuthChangedRef.current?.();
    }, 120_000);
    // Returning from the OAuth browser or recovering a missing push only reads
    // status; it must never start another authorization attempt.
    const refreshStatus = () => {
      if (active && attempt.current === capturedAttempt)
        onAuthChangedRef.current?.();
    };
    const poll = window.setInterval(refreshStatus, 5_000);
    window.addEventListener("focus", refreshStatus);

    return () => {
      active = false;
      clearTimeout(timeout);
      clearInterval(poll);
      window.removeEventListener("focus", refreshStatus);
      close?.();
      void unlistenPromise?.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [isAuthorizing, name]);

  const handleAuthorize = async () => {
    if (attempt.current) return;
    const capturedAttempt = {};
    attempt.current = capturedAttempt;
    setIsAuthorizing(true);
    try {
      const response = await mcpServerOauthLogin({
        name,
        threadId: null,
        scopes: null,
        timeoutSecs: 120n,
      });
      if (attempt.current !== capturedAttempt) return;
      await openExternalUrl(response.authorizationUrl);
      if (attempt.current !== capturedAttempt) return;
      notify("info", "Complete the authorization in your browser");
    } catch (error) {
      if (attempt.current !== capturedAttempt) return;
      attempt.current = null;
      setIsAuthorizing(false);
      notify("error", "Failed to start authorization: " + error);
    }
  };

  const handleDeleteServer = async () => {
    try {
      await unifiedRemoveMcpServer({ clientName: "codex", serverName: name });
      await loadServers();
    } catch (error) {
      console.error("Failed to delete MCP server:", error);
      notify("error", "Failed to delete MCP server: " + error);
    }
  };

  const handleToggleServerEnabled = async (enabled: boolean) => {
    try {
      if (enabled) {
        await unifiedEnableMcpServer({ clientName: "codex", serverName: name });
      } else {
        await unifiedDisableMcpServer({
          clientName: "codex",
          serverName: name,
        });
      }
      setServers((prev) => {
        const server = prev[name];
        if (!server) {
          return prev;
        }
        return {
          ...prev,
          [name]: {
            ...server,
            enabled,
          },
        };
      });
    } catch (error) {
      console.error("Failed to update MCP server enabled flag:", error);
      notify("error", "Failed to update MCP server enabled flag: " + error);
    }
  };

  return (
    <Card className="session-codex-mcp-server-card gap-0">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="session-mcp-server-identity flex items-center gap-2">
            <span className="session-mcp-server-name" title={name}>
              {name}
            </span>
            {supportsAuth && authStatus && (
              <Badge
                data-auth-status={authStatus}
                variant="outline"
                className={`text-[10px] font-normal px-1.5 h-4 uppercase ${
                  authStatus === "notLoggedIn"
                    ? "bg-red-500/10 text-red-500"
                    : authStatus === "unsupported"
                      ? "text-muted-foreground"
                      : "bg-green-500/10 text-green-500"
                }`}
              >
                {AUTH_STATUS_LABEL[authStatus]}
              </Badge>
            )}
          </span>
          <div className="session-mcp-server-actions flex gap-1 items-center">
            {needsAuth && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAuthorize}
                disabled={isAuthorizing}
                className="h-7 text-xs"
              >
                {isAuthorizing ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5 mr-1" />
                )}
                Authorize
              </Button>
            )}
            <Switch
              className="session-mcp-server-switch"
              checked={isEnabled}
              onCheckedChange={(checked) => handleToggleServerEnabled(checked)}
              aria-label={`Toggle ${name} server`}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${name} server`}
              onClick={() => onEdit(name, config)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${name} server`}
              onClick={handleDeleteServer}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="session-mcp-server-details text-xs text-muted-foreground">
          {serverType === "stdio" && (
            <div>
              <strong>Command:</strong>{" "}
              {"command" in config ? config.command : ""}
              {"args" in config && config.args && config.args.length > 0 && (
                <div>
                  <strong>Args:</strong> {config.args.join(" ")}
                </div>
              )}
              {"env" in config && config.env && (
                <div>
                  <strong>Env:</strong> {Object.keys(config.env).join(", ")}
                </div>
              )}
            </div>
          )}
          {serverType === "http" && "url" in config && (
            <div>
              <strong>url:</strong> {config.url}
            </div>
          )}
          {serverType === "sse" && "url" in config && (
            <div>
              <strong>url:</strong> {config.url}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
