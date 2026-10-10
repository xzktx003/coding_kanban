import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const instanceKey = Symbol.for("coding-kanban.web-dev-cache-instance");

/** The config module is evaluated again on reload; the Vite process stays alive. */
export function webDevCacheInstanceId() {
  globalThis[instanceKey] ??=
    `${process.pid}-${randomBytes(8).toString("hex")}`;
  return globalThis[instanceKey];
}

export function resolveWebDevCacheDir({
  projectRoot,
  mode = "development",
  instanceId = webDevCacheInstanceId(),
}) {
  const matched = /^([1-9][0-9]{0,9})-[a-f0-9]{16}$/.exec(instanceId);
  if (!matched || Number(matched[1]) > 2_147_483_647)
    throw new Error("Invalid Vite cache instance identifier");
  if (typeof mode !== "string" || mode.length > 256)
    throw new Error("Invalid Vite cache mode");
  const root = realpathSync(projectRoot);
  const scope = createHash("sha256")
    .update(root + "\0" + mode)
    .digest("hex")
    .slice(0, 16);
  // node_modules can be shared by symlinked worktrees. No optimizer should
  // replace another live process's chunks, even when both use the same port env.
  return join(root, ".dev-runtime", "vite-cache", `web-${scope}-${instanceId}`);
}
