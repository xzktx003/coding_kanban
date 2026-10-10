import type { FastifyInstance } from "fastify";
import { SessionGitHunks, type GitHunkRead, type GitHunkAction } from "../services/session-git-hunks.js";
function invalid(): never { throw Object.assign(new Error("逐块变更请求无效"), { statusCode: 400 }); }
function parse(value: unknown, action: boolean): GitHunkRead | GitHunkAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const b = value as Record<string, unknown>;
  const allowed = action ? ["cwd", "filePath", "staged", "hunkIndex", "expectedDigest", "action", "confirmRevert"] : ["cwd", "filePath", "staged"];
  if (Object.keys(b).some(key => !allowed.includes(key))) invalid();
  for (const key of ["cwd", "filePath"]) if (typeof b[key] !== "string" || !b[key] || (b[key] as string).length > 4096 || /[\x00-\x1f]/.test(b[key] as string)) invalid();
  if (typeof b.staged !== "boolean") invalid();
  if (action && (typeof b.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(b.expectedDigest) || !Number.isSafeInteger(b.hunkIndex) || Number(b.hunkIndex) < 0 || !["stage", "unstage", "revert"].includes(String(b.action)) || b.confirmRevert !== undefined && typeof b.confirmRevert !== "boolean")) invalid();
  return b as unknown as GitHunkRead | GitHunkAction;
}
export function registerSessionGitHunkRoutes(app: FastifyInstance, options: { service?: Pick<SessionGitHunks, "read" | "action"> } = {}) {
  const service = options.service ?? new SessionGitHunks();
  app.post("/api/session/git/hunks/read", { bodyLimit: 16384 }, async request => service.read(parse(request.body, false)));
  app.post("/api/session/git/hunks/action", { bodyLimit: 16384 }, async request => service.action(parse(request.body, true) as GitHunkAction));
}
