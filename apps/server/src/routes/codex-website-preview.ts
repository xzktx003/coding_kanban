import type { FastifyInstance } from "fastify";
import { WebsitePreviewService } from "../services/codex-website-preview.js";
export function registerCodexWebsitePreviewRoutes(
  app: FastifyInstance,
  service = new WebsitePreviewService(),
) {
  app.get("/api/session/api/codex/website-preview/capabilities", async () => ({
    supported: true,
  }));
  app.post("/api/session/api/codex/website-preview", async (request, reply) => {
    const body = request.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "url") ||
      typeof (body as Record<string, unknown>).url !== "string"
    )
      return reply.code(400).send({ error: "Invalid website preview input" });
    return service.get(body);
  });
  app.addHook("onClose", async () => service.dispose());
}
