import type { FastifyInstance } from "fastify";

import type {
  FeishuNotificationSettingsResponse,
  UpdateFeishuNotificationSettingsInput,
} from "@agent-orchestrator/shared";

import {
  FeishuNotificationNotConfiguredError,
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
          required: ["enabled"],
          properties: {
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return service.update(request.body.enabled);
      } catch (error) {
        if (error instanceof FeishuNotificationNotConfiguredError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
