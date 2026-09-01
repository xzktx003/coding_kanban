import type { FastifyInstance } from "fastify";

import type {
  FeishuNotificationSettingsResponse,
  UpdateFeishuNotificationSettingsInput,
} from "@agent-orchestrator/shared";

import {
  FeishuNotificationNotConfiguredError,
  FeishuReplyNotConfiguredError,
  type FeishuNotificationSettingsServiceLike,
} from "../services/feishu-notification-settings-service.js";

export async function registerFeishuNotificationSettingsRoutes(
  fastify: FastifyInstance,
  service: FeishuNotificationSettingsServiceLike,
): Promise<void> {
  fastify.get<{ Reply: FeishuNotificationSettingsResponse }>(
    "/api/settings/feishu-notifications",
    async () => service.get(),
  );

  fastify.put<{
    Body: UpdateFeishuNotificationSettingsInput;
    Reply: FeishuNotificationSettingsResponse | { error: string };
  }>(
    "/api/settings/feishu-notifications",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            enabled: { type: "boolean" },
            replyEnabled: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return service.update(request.body);
      } catch (error) {
        if (
          error instanceof FeishuNotificationNotConfiguredError ||
          error instanceof FeishuReplyNotConfiguredError
        ) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
