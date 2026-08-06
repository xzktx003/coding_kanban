import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";

import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { resolveWebDevConfig } from "./src/lib/dev-server-config";
import {
  VSCODE_HTTPS_CA_DOWNLOAD_PATH,
  VSCODE_SERVICE_WORKER_PROBE_PATH,
} from "./src/lib/vscode-service-worker";

const serviceWorkerProbeSource = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
`;

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

function readHttpsCaCertificate(
  env: Record<string, string | undefined>,
): Buffer | null {
  const caCertPath = env.VITE_DEV_HTTPS_CA_CERT?.trim();
  if (!caCertPath) {
    return null;
  }

  const parsed = new X509Certificate(readFileSync(caCertPath));
  if (!parsed.ca) {
    throw new Error(
      "VITE_DEV_HTTPS_CA_CERT must reference a CA certificate, not a leaf certificate",
    );
  }

  // Re-encode only the parsed public certificate. A misconfigured PEM bundle
  // must never expose appended private-key material through the download route.
  return Buffer.from(`${parsed.toString()}\n`, "utf8");
}

function vscodeWebviewHttpsSupportPlugin(caCertificate: Buffer | null): Plugin {
  return {
    name: "vscode-webview-https-support",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(
          request.url ?? "/",
          "http://coding-kanban.local",
        ).pathname;

        if (pathname === VSCODE_SERVICE_WORKER_PROBE_PATH) {
          response.statusCode = 200;
          response.setHeader("cache-control", "no-store");
          response.setHeader("content-type", "text/javascript; charset=utf-8");
          response.end(
            request.method === "HEAD" ? undefined : serviceWorkerProbeSource,
          );
          return;
        }

        if (pathname !== VSCODE_HTTPS_CA_DOWNLOAD_PATH) {
          next();
          return;
        }

        if (!caCertificate) {
          response.statusCode = 404;
          response.setHeader("content-type", "text/plain; charset=utf-8");
          response.end("No downloadable HTTPS CA is configured.");
          return;
        }

        response.statusCode = 200;
        response.setHeader("cache-control", "no-store");
        response.setHeader(
          "content-disposition",
          'attachment; filename="coding-kanban-dev-ca.crt"',
        );
        response.setHeader("content-type", "application/x-x509-ca-cert");
        response.end(request.method === "HEAD" ? undefined : caCertificate);
      });
    },
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
              server.config.logger.error(
                `HTTP fallback proxy error: ${err.message}`,
              );
              res.writeHead(502);
              res.end("Bad Gateway");
            });

            req.pipe(proxyReq, { end: true });
          });

          httpServer.on("error", (err: Error) => {
            server.config.logger.error(
              `HTTP fallback server error: ${err.message}`,
            );
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
  const httpsCaCertificate = readHttpsCaCertificate(env);

  return {
    plugins: [
      react(),
      vscodeWebviewHttpsSupportPlugin(httpsCaCertificate),
      httpFallbackPlugin(),
    ],
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
