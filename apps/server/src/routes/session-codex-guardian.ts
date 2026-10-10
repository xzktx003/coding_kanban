import type { FastifyInstance } from "fastify";
import type {
  GuardianReviewIdentity,
  GuardianDenialApproveRequest,
} from "@agent-orchestrator/shared";
import {
  CodexGuardianDenial,
  type GuardianDenialDependencies,
} from "../services/codex-guardian-denial.js";
function invalid(): never {
  throw Object.assign(new Error("Invalid Guardian approval identity"), {
    statusCode: 400,
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (
    Object.keys(value).length !== expected.length ||
    Object.keys(value).some((k) => !expected.includes(k))
  )
    invalid();
}
function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    /[\x00-\x1f]/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  )
    invalid();
  return value;
}
function parseIdentity(value: unknown): GuardianReviewIdentity {
  const b = object(value);
  keys(b, [
    "threadId",
    "turnId",
    "reviewId",
    "targetItemId",
    "startedAtMs",
    "completedAtMs",
  ]);
  id(b.threadId);
  id(b.turnId);
  id(b.reviewId);
  if (b.targetItemId !== null) id(b.targetItemId);
  if (
    !Number.isSafeInteger(b.startedAtMs) ||
    !Number.isSafeInteger(b.completedAtMs) ||
    (b.startedAtMs as number) < 0 ||
    (b.completedAtMs as number) < (b.startedAtMs as number)
  )
    invalid();
  return b as unknown as GuardianReviewIdentity;
}
export function registerSessionGuardianDenialRoutes(
  app: FastifyInstance,
  options: {
    service?: Pick<CodexGuardianDenial, "snapshot" | "approve">;
    dependencies?: GuardianDenialDependencies;
    file?: string;
  } = {},
) {
  const service =
    options.service ??
    new CodexGuardianDenial(options.dependencies, options.file);
  app.post(
    "/api/session/api/codex/guardian-denial/snapshot",
    { bodyLimit: 8192 },
    async (request) => {
      const b = object(request.body);
      keys(b, ["identity"]);
      return service.snapshot(parseIdentity(b.identity));
    },
  );
  app.post(
    "/api/session/api/codex/guardian-denial/approve",
    { bodyLimit: 8192 },
    async (request) => {
      const b = object(request.body);
      keys(b, [
        "identity",
        "runtimeInstance",
        "approvalToken",
        "clientRequestId",
      ]);
      parseIdentity(b.identity);
      id(b.runtimeInstance);
      id(b.clientRequestId);
      if (
        typeof b.approvalToken !== "string" ||
        !/^[a-f0-9]{64}$/.test(b.approvalToken)
      )
        invalid();
      return service.approve(b as unknown as GuardianDenialApproveRequest);
    },
  );
}
