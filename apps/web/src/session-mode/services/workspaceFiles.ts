import { postJsonWithOptions } from "./apiAdapt/shared";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
export interface TextSnapshot {
  path: string;
  content: string;
  version: string;
  size: number;
}
export interface TrashEntry {
  id: string;
  path: string;
  name: string;
  root: string;
  deletedAt: string;
}
export const workspaceFileRequest = <T>(action: string, body: unknown) =>
  postJsonWithOptions<T>("/workspace-files/" + action, body, {
    suppressToast: true,
  });
export const readWorkspaceVisualization = (root: string, path: string) =>
  workspaceFileRequest<TextSnapshot>("visualization", { root, path });
export const readWorkspaceText = (root: string, path: string) =>
  workspaceFileRequest<TextSnapshot>("read", { root, path });
export const saveWorkspaceText = (
  root: string,
  path: string,
  content: string,
  version: string,
) =>
  workspaceFileRequest<{ path: string; version: string }>("save", {
    root,
    path,
    content,
    version,
  });
export async function uploadWorkspaceFile(
  root: string,
  path: string,
  file: File,
  version?: string,
) {
  const data = new FormData();
  data.append("root", root);
  data.append("path", path);
  if (version) data.append("version", version);
  data.append("file", file);
  const response = await fetch(buildUrl("/workspace-files/upload"), {
    method: "POST",
    headers: authHeaders(),
    body: data,
  });
  if (!response.ok)
    throw new Error((await response.json()).error ?? "上传失败");
  return (await response.json()) as { path: string; version: string };
}
export async function downloadWorkspaceFile(root: string, path: string) {
  const response = await fetch(buildUrl("/workspace-files/download"), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ root, path }),
  });
  if (!response.ok)
    throw new Error((await response.json()).error ?? "下载失败");
  const url = URL.createObjectURL(await response.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() ?? "download";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function persistFileDraft(path: string) {
  const { useFileDocumentStore } =
    await import("@session/stores/useFileDocumentStore");
  const doc = useFileDocumentStore.getState().documents[path];
  if (!doc) throw new Error("文件尚未加载");
  const result = await saveWorkspaceText(
    doc.root,
    path,
    doc.draft,
    doc.version,
  );
  useFileDocumentStore.getState().saved(path, doc.draft, result.version);
}
