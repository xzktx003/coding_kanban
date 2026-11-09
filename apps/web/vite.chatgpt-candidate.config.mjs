import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import original from "./vite.config.ts";
import { configureChatGptCandidate, parseChatGptCandidateLegacyRoutes } from "./chatgpt-candidate-proxy.mjs";

export default async (environment) => {
  const raw = process.env.CHATGPT_DESKTOP_CANDIDATE_PORT;
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,4}$/.test(raw)) {
    throw new Error("Invalid ChatGPT candidate port");
  }
  const base = typeof original === "function" ? await original(environment) : original;
  // Main dev may already contain the opt-in routes. Rebuild only this explicit
  // candidate's fixed routes while preserving its stricter standalone policy.
  const candidateEnv = loadEnv(environment.mode, fileURLToPath(new URL("../../", import.meta.url)), "CHATGPT_DESKTOP_CANDIDATE_");
  const legacyRoutes = parseChatGptCandidateLegacyRoutes(candidateEnv.CHATGPT_DESKTOP_CANDIDATE_LEGACY_ROUTES);
  const configured = configureChatGptCandidate({ ...base, server: { ...base.server, proxy: {} } }, Number(raw), legacyRoutes);
  const ordinary = Object.fromEntries(Object.entries(base.server.proxy ?? {})
    .filter(([key]) => !Object.hasOwn(configured.server.proxy, key)));
  return { ...configured, server: { ...configured.server, proxy: { ...configured.server.proxy, ...ordinary } } };
};
