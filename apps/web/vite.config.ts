import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";

import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { resolveWebDevConfig } from "./src/lib/dev-server-config";

function readHttpsConfig(env: Record<string, string | undefined>) {
  if (env.VITE_DEV_HTTPS !== "1") {
    return undefined;
  }

  const certPath = env.VITE_DEV_HTTPS_CERT;
  const keyPath = env.VITE_DEV_HTTPS_KEY;

  if (!certPath || !keyPath) {
    throw new Error(
      "VITE_DEV_HTTPS=1 requires VITE_DEV_HTTPS_CERT and VITE_DEV_HTTPS_KEY",
    );
  }

  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
}

// Vite does not natively support listening on both HTTP and HTTPS simultaneously.
// This plugin adds a second HTTP server when HTTPS is enabled, so both protocols
// are available (required for browser notifications on a secure origin while
// keeping the old HTTP URL as a fallback).
function httpFallbackPlugin(): Plugin {
  return {
    name: "http-fallback",
    configureServer(server) {
      const httpConfig = server.config.server;
      if (!httpConfig.https) {
        return;
      }

      // Return a post hook that runs after all middlewares are set up
      return () => {
        // Wait for server to be fully ready before starting HTTP fallback
        setTimeout(() => {
          // Get the actual port from the server's address
          const serverAddress = server.httpServer?.address?.();
          if (!serverAddress || typeof serverAddress === "string") {
            server.config.logger.error("HTTP fallback: server not ready");
            return;
          }

          const httpsPort = serverAddress.port;
          const httpPort = httpsPort - 1; // HTTP uses port - 1
          const host = httpConfig.host;

          const httpServer = http.createServer((req, res) => {
            // Forward HTTP requests to the HTTPS server using https.request
            const options = {
              hostname: "127.0.0.1",
              port: httpsPort,
              path: req.url,
              method: req.method,
              headers: req.headers,
              rejectUnauthorized: false, // Allow self-signed certs
            };

            const proxyReq = https.request(options, (proxyRes) => {
              res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
              proxyRes.pipe(res, { end: true });
            });

            proxyReq.on("error", (err) => {
              server.config.logger.error(`HTTP fallback proxy error: ${err.message}`);
              res.writeHead(502);
              res.end("Bad Gateway");
            });

            req.pipe(proxyReq, { end: true });
          });

          httpServer.on("error", (err: Error) => {
            server.config.logger.error(`HTTP fallback server error: ${err.message}`);
          });

          httpServer.listen(httpPort, host as string, () => {
            server.config.logger.info(
              `  ➜ HTTP Fallback: http://${host ?? "localhost"}:${httpPort}/`,
            );
          });
        }, 500);
      };
    },
  };
}

// Backend host:port is looked up from .env (WEB_BACKEND_HOST / WEB_BACKEND_PORT)
// so users can redirect API/WebSocket traffic without editing source code.
// See .env.example at repo root.
export default defineConfig(({ mode }) => {
  const env = {
    ...process.env,
    ...loadEnv(mode, resolve(__dirname, "../.."), ""),
  };

  const webConfig = resolveWebDevConfig(env);
  const WEB_HOST = env.WEB_HOST?.trim() || "0.0.0.0";

  return {
    plugins: [react(), httpFallbackPlugin()],
    server: {
      host: WEB_HOST,
      port: webConfig.webPort,
      https: readHttpsConfig(env),
      proxy: {
        "/api": webConfig.apiTarget,
        "/vscode": {
          target: webConfig.apiTarget,
          ws: true,
        },
        "/ws": {
          target: webConfig.wsTarget,
          ws: true,
        },
      },
    },
  };
});