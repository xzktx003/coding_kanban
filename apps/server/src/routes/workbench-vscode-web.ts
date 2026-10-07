import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, isAbsolute, normalize } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  VsCodeWebUnavailableError,
  type VsCodeWebManager,
} from "../services/vscode-web-manager.js";
import { resolveVsCodeWebRequestTarget } from "./vscode-web-request-target.js";

export function registerWorkbenchVsCodeWebRoutes(
  app: FastifyInstance,
  manager: Pick<VsCodeWebManager, "ensureSession">,
): void {
  app.post<{ Body: { path?: unknown } }>(
    "/api/workbench/vscode-web",
    async (request, reply) => {
      const path = request.body?.path;
      if (
        typeof path !== "string" ||
        !isAbsolute(path) ||
        /[\x00-\x1f\x7f]/.test(path)
      ) {
        return reply
          .code(400)
          .send({ error: "请选择有效的服务器绝对目录路径。" });
      }
      const workingDirectory = normalize(path);
      try {
        if (!(await stat(workingDirectory)).isDirectory())
          throw new Error("not a directory");
      } catch {
        return reply.code(400).send({ error: "项目目录不存在或无法访问。" });
      }
      try {
        // A stable editor workspace shares the existing manager without registering
        // a terminal or launching an Agent just to open a project directory.
        return await manager.ensureSession(
          {
            id: `session-project-${createHash("sha256").update(workingDirectory).digest("hex")}`,
            workspaceId: "default",
            sourceType: "local",
            agentKind: "shell",
            displayName: basename(workingDirectory) || workingDirectory,
            workingDirectory,
            connectionState: "online",
            interactionState: "idle",
          },
          resolveVsCodeWebRequestTarget(request),
        );
      } catch (error) {
        if (error instanceof VsCodeWebUnavailableError) {
          return reply.code(503).send({ error: error.message });
        }
        request.log.error(
          error,
          "Failed to open a session project in VS Code Web",
        );
        return reply
          .code(503)
          .send({ error: "VS Code Web 启动失败，请稍后重试。" });
      }
    },
  );
}
