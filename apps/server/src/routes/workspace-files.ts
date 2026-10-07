import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { basename } from "node:path";
import { guessMimeType } from "../services/file-system-utils.js";
import {
  WorkspaceFiles,
  WorkspaceFileError,
} from "../services/workspace-files.js";
export function registerWorkspaceFileRoutes(
  app: FastifyInstance,
  options: { trashHome?: string; roots: () => Promise<string[]> },
) {
  app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: 64 * 1024 * 1024, files: 1, fields: 4 },
    });
    const files = options.trashHome
      ? new WorkspaceFiles(options.trashHome, options.roots)
      : null;
    const prefix = "/api/session/workspace-files/";
    scope.setErrorHandler((error, request, reply) => {
      const status =
        error instanceof WorkspaceFileError
          ? error.status
          : typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : (error as NodeJS.ErrnoException).code === "ENOENT"
              ? 404
              : 400;
      return reply.code(Number.isFinite(status) ? status : 400).send({
        error: error instanceof Error ? error.message : "文件操作失败",
      });
    });
    scope.addHook("preHandler", async (request, reply) => {
      if (!files) return reply.code(503).send({ error: "文件管理存储不可用" });
    });
    scope.get<{ Querystring: { root: string; path: string } }>(
      prefix + "asset",
      async (req, reply) => {
        const result = await files!.download(req.query.root, req.query.path);
        const mime = guessMimeType(result.path);
        if (!mime?.startsWith("image/") || mime === "image/svg+xml") {
          if (mime !== "image/svg+xml") {
            result.stream.destroy();
            throw new WorkspaceFileError("只支持图片预览", 415);
          }
        }
        reply
          .header("content-type", mime ?? "application/octet-stream")
          .header("x-content-type-options", "nosniff")
          .header(
            "content-security-policy",
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          )
          .header("cache-control", "no-store");
        return reply.send(result.stream);
      },
    );
    interface Input {
      root: string;
      path: string;
      content: string;
      version: string | null;
      kind: "file" | "directory";
      destination: string;
      id: string;
    }
    for (const action of [
      "visualization",
      "read",
      "version",
      "save",
      "create",
      "move",
      "trash",
      "trash-list",
      "restore",
      "purge",
      "download",
    ] as const) {
      scope.post<{ Body: Input }>(
        prefix + action,
        { bodyLimit: 5 * 1024 * 1024 },
        async (req, reply) => {
          const b = req.body;
          if (!b || typeof b.root !== "string")
            throw new WorkspaceFileError("缺少项目目录");
          reply.header("cache-control", "no-store");
          switch (action) {
            case "visualization": {
              if (typeof b.path !== "string" || !/[.]html?$/i.test(b.path))
                throw new WorkspaceFileError("可视化预览只支持 HTML 文件", 415);
              return files!.read(b.root, b.path, 1_000_000);
            }
            case "read":
              return files!.read(b.root, b.path);
            case "version":
              return files!.version(b.root, b.path);
            case "save":
              return files!.save(b.root, b.path, b.content, b.version);
            case "create":
              return files!.create(b.root, b.path, b.kind);
            case "move":
              return files!.move(b.root, b.path, b.destination);
            case "trash":
              return files!.trash(b.root, b.path);
            case "trash-list":
              return files!.listTrash(b.root);
            case "restore":
              return files!.restore(b.root, b.id);
            case "purge":
              return files!.purge(b.root, b.id);
            case "download": {
              const result = await files!.download(b.root, b.path);
              reply
                .header("content-type", "application/octet-stream")
                .header("x-content-type-options", "nosniff")
                .header(
                  "content-disposition",
                  `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(basename(result.path)).replace(/'/g, "%27")}`,
                );
              return reply.send(result.stream);
            }
          }
        },
      );
    }
    scope.post(prefix + "upload", async (req) => {
      const part = await req.file();
      if (!part) throw new WorkspaceFileError("请选择上传文件");
      const fields = part.fields as Record<string, { value?: unknown }>;
      const root = fields.root?.value,
        path = fields.path?.value,
        version = fields.version?.value;
      if (typeof root !== "string" || typeof path !== "string")
        throw new WorkspaceFileError("上传文件前必须指定项目和目标路径");
      const bytes = await part.toBuffer();
      return files!.upload(
        root,
        path,
        bytes,
        typeof version === "string" ? version : null,
      );
    });
  });
}
