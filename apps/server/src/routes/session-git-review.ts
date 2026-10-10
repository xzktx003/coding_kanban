import type { FastifyInstance } from "fastify";
import { SessionGitReview, parseGitReviewRead } from "../services/session-git-review.js";
export function registerSessionGitReviewRoutes(app: FastifyInstance) {
  const service = new SessionGitReview();
  app.post("/api/session/git/review/read", { bodyLimit: 16384 }, async request => service.read(parseGitReviewRead(request.body)));
}
