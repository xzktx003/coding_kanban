import type {
  CommandExecutionApprovalDecision,
  FileChangeApprovalDecision,
} from "@session/bindings/v2";
import type { ApprovalRequest } from "./useApprovalStore";

export type ApprovalDecision =
  | CommandExecutionApprovalDecision
  | FileChangeApprovalDecision;

export function approvalDecisionKey(decision: ApprovalDecision): string {
  if (typeof decision === "string") return decision;
  if ("acceptWithExecpolicyAmendment" in decision) {
    return JSON.stringify([
      "execpolicy",
      decision.acceptWithExecpolicyAmendment.execpolicy_amendment,
    ]);
  }
  const amendment =
    decision.applyNetworkPolicyAmendment.network_policy_amendment;
  return JSON.stringify(["network", amendment.host, amendment.action]);
}

/** Native explicit lists (including []) are authoritative. Older servers use the legacy scopes. */
export function approvalDecisions(
  request: ApprovalRequest,
): ApprovalDecision[] {
  if (
    request.type === "commandExecution" &&
    request.availableDecisions != null
  ) {
    return request.availableDecisions;
  }
  const decisions: ApprovalDecision[] = ["accept", "acceptForSession"];
  if (request.type === "commandExecution") {
    const prefix = request.proposedExecpolicyAmendment;
    if (prefix?.length && !prefix.some((part) => /[\r\n]/.test(part))) {
      decisions.push({
        acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix },
      });
    }
    for (const amendment of request.proposedNetworkPolicyAmendments ?? []) {
      decisions.push({
        applyNetworkPolicyAmendment: { network_policy_amendment: amendment },
      });
    }
  }
  return [...decisions, "decline"];
}

export function allowsApprovalDecision(
  request: ApprovalRequest,
  decision: ApprovalDecision,
) {
  const key = approvalDecisionKey(decision);
  return approvalDecisions(request).some(
    (allowed) => approvalDecisionKey(allowed) === key,
  );
}
