import type { ComposerContext } from "@agent-orchestrator/shared";
import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
import { newSessionEditId } from "@session/services/sessionEditIdentity";

export interface ProjectReferenceEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}
export interface ProjectDirectory {
  root: string;
  path: string;
  entries: ProjectReferenceEntry[];
  truncated: boolean;
}
export interface ProjectReference {
  root: string;
  path: string;
  kind: "file" | "directory";
  content: string;
  version: string;
  truncated: boolean;
}
export const listProjectReferences = (
  root: string,
  path: string,
  signal: AbortSignal,
) =>
  postJsonWithOptions<ProjectDirectory>(
    "/workspace-files/list",
    { root, path },
    { signal, suppressToast: true },
  );
export const readProjectReference = (
  root: string,
  path: string,
  signal: AbortSignal,
) =>
  postJsonWithOptions<ProjectReference>(
    "/workspace-files/reference",
    { root, path },
    { signal, suppressToast: true },
  );
export function referenceContext(value: ProjectReference): ComposerContext {
  if (
    !value ||
    !["file", "directory"].includes(value.kind) ||
    typeof value.content !== "string" ||
    value.content.length > 180_000 ||
    new TextEncoder().encode(value.content).byteLength > 180_000 ||
    typeof value.root !== "string" ||
    typeof value.path !== "string" ||
    !value.root.startsWith("/") ||
    value.root === "/" ||
    !(
      value.path === value.root ||
      value.path.startsWith(value.root.replace(/\/$/, "") + "/")
    ) ||
    value.path.split("/").includes("..") ||
    /[\x00-\x1f]/.test(value.root + value.path) ||
    !/^[a-f0-9]{64}$/.test(value.version)
  )
    throw new Error("项目引用响应无效，请重新选择。");
  return {
    id: newSessionEditId(),
    kind: "file",
    sourceKind: value.kind,
    workspaceRoot: value.root,
    version: value.version,
    name: value.path.split("/").filter(Boolean).pop() ?? value.path,
    path: value.path,
    text: value.content,
  };
}
