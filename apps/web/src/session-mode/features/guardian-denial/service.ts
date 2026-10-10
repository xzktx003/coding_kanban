import type {
  GuardianDenialApproveRequest,
  GuardianDenialResult,
  GuardianDenialSnapshot,
  GuardianReviewIdentity,
} from "@agent-orchestrator/shared";
import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
export const guardianDenialService = {
  snapshot: (identity: GuardianReviewIdentity) =>
    postJsonWithOptions<GuardianDenialSnapshot>(
      "/api/codex/guardian-denial/snapshot",
      { identity },
      { suppressToast: true },
    ),
  approve: (request: GuardianDenialApproveRequest) =>
    postJsonWithOptions<GuardianDenialResult>(
      "/api/codex/guardian-denial/approve",
      request,
      { suppressToast: true },
    ),
};
