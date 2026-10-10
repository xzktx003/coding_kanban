import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
import type { ReviewTarget } from "@session/bindings/v2";
export interface GitReviewSnapshot {
  cwd: string; target: Exclude<ReviewTarget, { type: "custom" }>;
  resolved: { head: string; base?: string; commit?: string };
  capturedAt: string; digest: string; unifiedDiff: string;
  omitted: Array<{ path: string; reason: string }>;
}
export const readGitReviewSnapshot = (cwd: string, target: ReviewTarget) => postJsonWithOptions<GitReviewSnapshot>("/git/review/read", { cwd, target }, { suppressToast: true });
