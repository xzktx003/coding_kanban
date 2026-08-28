import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { isCodexSessionCandidate } from "@agent-orchestrator/shared";

import type { AgentSessionRegistry } from "../services/agent-session-registry.js";
import { resolveActiveCodexSessionId } from "../services/active-codex-session-resolver.js";
import type { CodexSessionLocator } from "../services/codex-session-locator.js";
import {
  CodexImageMessageUnavailableError,
  type CodexImageExtension,
  type CodexImageMessageService,
} from "../services/codex-image-message-service.js";

export const MAX_CODEX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CODEX_IMAGE_MESSAGE_CHARACTERS = 8_000;
const DEFAULT_CODEX_IMAGE_MESSAGE = "请查看这张图片。";

interface CodexImageMessageRoutesOptions {
  registry: Pick<AgentSessionRegistry, "get" | "has" | "updateSession">;
  codexSessionLocator: Pick<CodexSessionLocator, "resolve">;
  codexImageMessageService: Pick<CodexImageMessageService, "send">;
}

class CodexImageRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function detectImageExtension(image: Buffer): CodexImageExtension | null {
  if (
    image.length >= 8 &&
    image
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    image.length >= 3 &&
    image[0] === 0xff &&
    image[1] === 0xd8 &&
    image[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    image.length >= 12 &&
    image.subarray(0, 4).toString("ascii") === "RIFF" &&
    image.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

async function readImageParts(request: Pick<FastifyRequest, "parts">): Promise<{
  image: Buffer;
  imageExtension: CodexImageExtension;
  message: string;
}> {
  let image: Buffer | null = null;
  let message = DEFAULT_CODEX_IMAGE_MESSAGE;

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (part.fieldname === "message") {
        const nextMessage = String(part.value).trim();
        if (nextMessage.length > MAX_CODEX_IMAGE_MESSAGE_CHARACTERS) {
          throw new CodexImageRequestError("图片说明不能超过 8000 个字符", 400);
        }
        message = nextMessage || DEFAULT_CODEX_IMAGE_MESSAGE;
      }
      continue;
    }

    if (part.fieldname !== "image") {
      for await (const _chunk of part.file) {
        // Drain unsupported file fields before returning a bounded error.
      }
      throw new CodexImageRequestError("图片字段名称无效", 400);
    }
    if (image) {
      for await (const _chunk of part.file) {
        // Only one image is accepted per message in the first version.
      }
      throw new CodexImageRequestError("每次只能发送一张图片", 400);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of part.file) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_CODEX_IMAGE_BYTES) {
        throw new CodexImageRequestError("图片不能超过 10 MB", 413);
      }
      chunks.push(buffer);
    }
    if (part.file.truncated) {
      throw new CodexImageRequestError("图片不能超过 10 MB", 413);
    }
    image = Buffer.concat(chunks, totalBytes);
  }

  if (!image || image.length === 0) {
    throw new CodexImageRequestError("请选择要发送的图片", 400);
  }
  const imageExtension = detectImageExtension(image);
  if (!imageExtension) {
    throw new CodexImageRequestError(
      "当前只支持真实的 PNG、JPEG 或 WebP 图片",
      400,
    );
  }
  return { image, imageExtension, message };
}

export async function registerCodexImageMessageRoutes(
  fastify: FastifyInstance,
  options: CodexImageMessageRoutesOptions,
): Promise<void> {
  await fastify.register(multipart, {
    limits: {
      files: 1,
      fileSize: MAX_CODEX_IMAGE_BYTES,
      fields: 4,
      fieldSize: MAX_CODEX_IMAGE_MESSAGE_CHARACTERS * 4,
    },
  });

  fastify.post<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/image-message",
    async (request, reply) => {
      try {
        if (!options.registry.has(request.params.id)) {
          throw new CodexImageRequestError("当前终端会话不存在", 404);
        }
        const agentSession = options.registry.get(request.params.id);
        if (!isCodexSessionCandidate(agentSession)) {
          throw new CodexImageRequestError(
            "当前终端不是可识别的 Codex 会话",
            409,
          );
        }

        const { image, imageExtension, message } =
          await readImageParts(request);
        const threadId = await resolveActiveCodexSessionId(agentSession, {
          registry: options.registry,
          codexSessionLocator: options.codexSessionLocator,
        });
        if (!threadId) {
          throw new CodexImageRequestError(
            "当前 tmux 窗格没有正在运行的 Codex 对话",
            409,
          );
        }

        await options.codexImageMessageService.send({
          threadId,
          message,
          image,
          imageExtension,
          workingDirectory: agentSession.workingDirectory,
          ...(agentSession.sshTarget
            ? { sshTarget: agentSession.sshTarget }
            : {}),
        });
        reply.code(202);
        return { ok: true, threadId };
      } catch (error) {
        if (error instanceof CodexImageRequestError) {
          reply.code(error.statusCode);
          return { error: error.message };
        }
        const multipartErrorCode =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        if (
          multipartErrorCode === "FST_REQ_FILE_TOO_LARGE" ||
          multipartErrorCode === "FST_FILES_LIMIT"
        ) {
          reply.code(413);
          return { error: "图片不能超过 10 MB，且每次只能发送一张" };
        }
        if (
          multipartErrorCode === "FST_FIELDS_LIMIT" ||
          multipartErrorCode === "FST_PARTS_LIMIT"
        ) {
          reply.code(400);
          return { error: "图片请求包含过多字段" };
        }
        if (error instanceof CodexImageMessageUnavailableError) {
          reply.code(503);
          return { error: error.message };
        }
        request.log.error({ err: error }, "Failed to send image to Codex");
        reply.code(500);
        return { error: "Codex 图片发送失败" };
      }
    },
  );
}
