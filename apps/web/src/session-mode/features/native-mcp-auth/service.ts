import { mcpOAuthThreadIdSupported } from "@agent-orchestrator/shared";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { openEventStream } from "@session/lib/eventStream";
import { usePairingStore } from "@session/stores/usePairingStore";
import { useCodexStore } from "@session/components/codex/stores";
import { i18n } from "@session/lib/i18n";
import { nativeNotifications } from "../native-notifications/service";
import { McpReauthentication } from "./controller";
import { mcpAuthLabels } from "./messages";
import { showMcpPrompt } from "./NativeMcpAuthentication";
const dismissals = new Map<string, object>();
const accountKey = () => {
  const { account, accountNamespace } = useCodexStore.getState();
  return JSON.stringify(
    account?.type === "chatgpt"
      ? [account.type, accountNamespace ?? account.email]
      : account,
  );
};
/** One metadata consumer using the existing view=chat stream; no history/body observer. */
export function startMcpAuthentication() {
  let controller: McpReauthentication | undefined,
    threadSupported = false,
    reloadSupported = false,
    versionKnown = false,
    account = accountKey(),
    stamp = "",
    alive = true;
  function reset() {
    controller?.stop();
    threadSupported = false;
    reloadSupported = false;
    versionKnown = false;
    const endpoint = buildUrl(""),
      headers = authHeaders();
    stamp = JSON.stringify([endpoint, headers]);
    const request = async (
      path: string,
      body: unknown,
      signal: AbortSignal,
    ) => {
      const response = await fetch(endpoint + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) throw new Error("MCP request failed");
      return response.json();
    };
    const captured = new McpReauthentication(
      JSON.stringify([endpoint, account]),
      {
        startupEnabled: async (signal) => {
          const result = await request("/api/codex/config/read", {}, signal);
          return result?.config?.desktop?.mcp_startup_authentication === true;
        },
        inventory: async (cursor, signal) =>
          request(
            "/api/codex/mcp/status/list",
            { cursor, detail: "toolsAndAuthOnly", limit: 100 },
            signal,
          ),
        oauth: async (params, signal) =>
          request("/api/codex/mcp/oauth/login", params, signal),
        reload: async (signal) => {
          if (reloadSupported)
            await request("/api/codex/mcp/reload", {}, signal);
        },
        threadIdSupported: () => threadSupported,
        open: (href) => {
          const url = new URL(href);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            throw new Error("Invalid MCP authorization URL");
          window.open(url.href, "_blank", "noopener,noreferrer");
        },
        prompt: showMcpPrompt,
        error: (kind, name) => {
          const labels = mcpAuthLabels(i18n.language ?? "zh", name);
          nativeNotifications.danger(
            kind === "start" ? labels.startError : labels.completionError,
            {
              id:
                "mcp-reauthentication-required:error:" +
                JSON.stringify([endpoint, name]),
            },
          );
        },
      },
      dismissals,
    );
    controller = captured;
    const signal = new AbortController();
    void fetch(endpoint + "/health", { headers, signal: signal.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && controller === captured) {
          if (!versionKnown)
            threadSupported =
              data?.capabilities?.codexMcpOAuthThreadId === true;
          reloadSupported = data?.capabilities?.codexMcpAuthV1 === true;
        }
      })
      .catch(() => {});
    void captured.selectThread(useCodexStore.getState().currentThreadId);
    void captured.refresh();
    return () => signal.abort();
  }
  let stopHealth = reset();
  const restart = () => {
    stopHealth();
    stopHealth = reset();
  };
  const stopEvents = openEventStream({
    agents: ["codex"],
    label: "mcp-authentication",
    onResync: () => {
      void controller?.refresh();
    },
    onEvent: (event) => {
      if (event.event === "codex:disconnected") {
        controller?.stop();
        controller = undefined;
        return;
      }
      if (event.event === "codex:initialized") {
        if (!controller) restart();
        threadSupported = mcpOAuthThreadIdSupported(
          (event.payload as any)?.userAgent,
        );
        versionKnown = true;
        return;
      }
      const payload = event.payload as any;
      if (payload && typeof payload.method === "string")
        void controller?.event(payload.method, payload.params);
    },
  });
  const stopIdentity = usePairingStore.subscribe(() => {
    const next = JSON.stringify([buildUrl(""), authHeaders()]);
    if (next !== stamp) restart();
  });
  const stopAccount = useCodexStore.subscribe((state, previous) => {
    const next = accountKey();
    if (next !== account) {
      account = next;
      restart();
    } else if (state.currentThreadId !== previous.currentThreadId)
      void controller?.selectThread(state.currentThreadId);
  });
  window.addEventListener("session-runtime-restarted", restart);
  return () => {
    alive = false;
    stopEvents();
    stopAccount();
    stopIdentity();
    stopHealth();
    controller?.stop();
    window.removeEventListener("session-runtime-restarted", restart);
  };
}
