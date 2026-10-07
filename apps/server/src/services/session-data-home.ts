import { resolve } from "node:path";
/** All session records resolve relative configuration against the repository, never process.cwd(). */
export function resolveSessionDataHome(
  sourceRoot: string,
  configured?: string,
) {
  const home = resolve(
    sourceRoot,
    configured?.trim() || ".dev-runtime/session-mode",
  );
  if (/[\x00-\x1f]/.test(home))
    throw new Error("Invalid session data directory");
  return home;
}
