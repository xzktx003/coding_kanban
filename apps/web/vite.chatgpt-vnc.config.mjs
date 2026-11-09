import original from "./vite.config.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { enableChatgptDocumentGuard } from "./chatgpt-safe-candidate.mjs";
import {
  configureVncCandidate,
  nativeDesktopEntryPlugin,
  readOwnedVncToken,
} from "./chatgpt-vnc-candidate.mjs";

// Explicit opt-in only. Start a new candidate with this config; do not replace
// a running workbench. CG_VNC_* values stay server-side and may come from the
// repository's ignored .env files or the candidate's private EnvironmentFile.
export default async (environment) => {
  const env = {
    ...loadEnv(
      environment.mode,
      fileURLToPath(new URL("../../", import.meta.url)),
      ["CG_VNC_", "VITE_DEV_"],
    ),
    ...process.env,
  };
  const certificate = env.CG_VNC_TLS_CERT_FILE || env.VITE_DEV_HTTPS_CERT;
  const key = env.CG_VNC_TLS_KEY_FILE || env.VITE_DEV_HTTPS_KEY;
  if (!certificate || !key)
    throw new Error("Native desktop candidate requires TLS files");
  const base = enableChatgptDocumentGuard(
    typeof original === "function" ? await original(environment) : original,
  );
  const configured = configureVncCandidate(base, {
    origin: env.CG_VNC_PUBLIC_ORIGIN,
    port: Number(env.CG_VNC_WEB_PORT),
    target: env.CG_VNC_BROKER_ORIGIN,
    token: readOwnedVncToken(env.CG_VNC_BROKER_TOKEN_FILE),
  });
  return {
    ...configured,
    plugins: [...configured.plugins, nativeDesktopEntryPlugin()],
    server: {
      ...configured.server,
      https: { cert: readFileSync(certificate), key: readFileSync(key) },
    },
  };
};
