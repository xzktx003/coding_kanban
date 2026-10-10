import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
export interface GitHunkSnapshot {
  digest: string; unifiedDiff: string; binary: boolean;
  hunks: Array<{ index: number; oldStart: number; oldCount: number; newStart: number; newCount: number }>;
}
export interface GitHunkScope { cwd: string; filePath: string; staged: boolean }
export const gitHunkRead = (scope: GitHunkScope) => postJsonWithOptions<GitHunkSnapshot>("/git/hunks/read", scope, { suppressToast: true });
export const gitHunkAction = (input: GitHunkScope & { hunkIndex: number; expectedDigest: string; action: "stage" | "unstage" | "revert"; confirmRevert?: boolean }) => postJsonWithOptions<{ status: "success" }>("/git/hunks/action", input, { suppressToast: true });
