import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import type { McpAuthStatus } from "@session/bindings/v2";
import { isTauri } from "@session/hooks/runtime";
import { listMcpServerStatus } from "@session/services";
import { openEventStream } from "@session/lib/eventStream";

/**
 * Fetches MCP server auth statuses from the codex app-server and keeps them
 * fresh when the server pushes status / oauth notifications.
 */
export function useMcpAuthStatus() {
  const [authStatuses, setAuthStatuses] = useState<
    Record<string, McpAuthStatus>
  >({});
  const mounted = useRef(false);
  const version = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const response = await listMcpServerStatus({
        cursor: null,
        limit: null,
        detail: "toolsAndAuthOnly",
        threadId: null,
      });
      const next: Record<string, McpAuthStatus> = {};
      for (const status of response.data) {
        next[status.name] = status.authStatus;
      }
      if (mounted.current && request === version.current) setAuthStatuses(next);
    } catch (error) {
      // The codex backend may be unavailable; auth badges are optional.
      console.warn(
        "[useMcpAuthStatus] failed to list mcp server status:",
        error,
      );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      version.current++;
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  useEffect(() => {
    const notification = ({ method }: ServerNotification) => {
      if (
        method === "mcpServer/oauthLogin/completed" ||
        method === "mcpServer/startupStatus/updated"
      )
        void refresh();
    };
    if (!isTauri()) {
      return openEventStream({
        agents: ["codex"],
        label: "mcp-auth-status",
        onResync: () => {
          void refresh();
        },
        onEvent: (event) => {
          if (
            event.event === "codex:notification" &&
            event.payload &&
            typeof event.payload === "object"
          )
            notification(event.payload as ServerNotification);
        },
      });
    }
    let active = true;
    const unlistenPromise = listen<ServerNotification>(
      "codex:notification",
      (event) => {
        if (active) notification(event.payload);
      },
    );

    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [refresh]);

  return { authStatuses, refreshAuthStatuses: refresh };
}
