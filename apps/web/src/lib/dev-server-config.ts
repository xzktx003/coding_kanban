import type { ProxyOptions } from "vite";

// Forward abandonment even after the POST body completed. HTTP/2 resets can
// emit finish before response.close, so observe request.aborted as well.
const cancelAbandonedRead: NonNullable<ProxyOptions["configure"]> = (proxy) => {
  proxy.on("proxyReq", (outgoing, request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const views = url.searchParams.getAll("view");
    let auxiliaryRead = false;
    try {
      const pathname = decodeURIComponent(url.pathname);
      auxiliaryRead = (views.length === 1 && views[0] === "recent" &&
        ["/api/session/api/cc/session-messages", "/api/session/api/acp/session"].includes(pathname)) ||
        (!url.search && ["/api/session/api/cc/session-message-detail", "/api/session/api/cc/session-message-image", "/api/session/api/acp/session-detail", "/api/session/api/acp/session-image"].includes(pathname));
    } catch { /* Invalid encoded paths cannot opt into read cancellation. */ }
    if (
      request.method !== "POST" ||
      !(
        url.pathname === "/api/session/api/codex/thread/item-detail" ||
        (url.pathname === "/api/session/api/codex/thread/turns/list" &&
          url.searchParams.get("view") === "chat") || auxiliaryRead
      )
    )
      return;
    const cleanup = () => {
      request.off("aborted", cancel);
      response.off("close", cancel);
      response.off("finish", cleanup);
    };
    const cancel = () => {
      cleanup();
      if (!response.writableFinished) outgoing.destroy();
    };
    response.once("close", cancel);
    response.once("finish", cleanup);
    request.once("aborted", cancel);
    if (response.destroyed) cancel();
  });
};

export type WebDevConfig = {
  webPort: number;
  serverPort: number;
  apiTarget: string;
  wsTarget: string;
};

function parsePort(
  value: string | undefined,
  fallback: number,
  envName: string,
): number {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `${envName} must be a positive integer between 1 and 65535`,
    );
  }

  return parsed;
}

function formatRedirectHostname(localAddress: string | undefined): string {
  const normalized = (localAddress || "127.0.0.1").replace(/^::ffff:/, "");
  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

export function resolveHttpsFallbackRedirectLocation(
  requestUrl: string | undefined,
  localAddress: string | undefined,
  httpsPort: number,
): string {
  const parsedPath = new URL(requestUrl || "/", "http://fallback.local");
  const hostname = formatRedirectHostname(localAddress);
  return `https://${hostname}:${httpsPort}${parsedPath.pathname}${parsedPath.search}`;
}

function resolveBackendPort(env: Record<string, string | undefined>): number {
  if (env.WEB_BACKEND_PORT?.trim()) {
    return parsePort(env.WEB_BACKEND_PORT, 4000, "WEB_BACKEND_PORT");
  }

  if (env.SERVER_PORT?.trim()) {
    return parsePort(env.SERVER_PORT, 4000, "SERVER_PORT");
  }

  if (env.PORT?.trim()) {
    return parsePort(env.PORT, 4000, "PORT");
  }

  return 4000;
}

export function resolveWebDevConfig(
  env: Record<string, string | undefined>,
): WebDevConfig {
  const webPort = parsePort(env.WEB_PORT, 8484, "WEB_PORT");
  const serverPort = resolveBackendPort(env);
  const backendHost = env.WEB_BACKEND_HOST?.trim() || "localhost";

  return {
    webPort,
    serverPort,
    apiTarget: `http://${backendHost}:${serverPort}`,
    wsTarget: `ws://${backendHost}:${serverPort}`,
  };
}

/** Vite string targets imply changeOrigin:true, breaking exact browser Origin/Host checks. */
export function resolveWebDevProxies(
  config: Pick<WebDevConfig, "apiTarget" | "wsTarget">,
) {
  return {
    "/api": {
      target: config.apiTarget,
      changeOrigin: false,
      xfwd: true,
      configure: cancelAbandonedRead,
    },
    "/vscode": { target: config.apiTarget, changeOrigin: false, ws: true },
    "/native-codex": {
      target: config.apiTarget,
      changeOrigin: false,
      xfwd: true,
      ws: true,
    },
    "/ws": { target: config.wsTarget, changeOrigin: false, ws: true },
  };
}
