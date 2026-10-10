import { postJsonWithOptions } from "./apiAdapt/shared";
import { authHeaders, buildEventUrl, buildUrl } from "@session/hooks/runtime";
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
export interface UploadWorkspaceFileOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}
export async function uploadWorkspaceFile(
  root: string,
  path: string,
  file: File,
  version?: string,
  options: UploadWorkspaceFileOptions = {},
) {
  return new Promise<{ path: string; version: string }>((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) {
      reject(new DOMException("上传已取消", "AbortError"));
      return;
    }
    const data = new FormData();
    data.append("root", root);
    data.append("path", path);
    if (version) data.append("version", version);
    data.append("file", file);
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
    };
    const finishResolve = (value: { path: string; version: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error: Error | DOMException) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      xhr.abort();
      finishReject(new DOMException("上传已取消", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let message = "上传失败";
        try {
          message = JSON.parse(xhr.responseText).error ?? message;
        } catch {}
        finishReject(new Error(message));
        return;
      }
      try {
        finishResolve(JSON.parse(xhr.responseText));
      } catch {
        finishReject(new Error("上传结果解析失败"));
      }
    };
    xhr.onerror = () => finishReject(new Error("上传失败"));
    xhr.onabort = () =>
      finishReject(new DOMException("上传已取消", "AbortError"));
    try {
      xhr.open("POST", buildUrl("/workspace-files/upload"));
      for (const [key, value] of Object.entries(authHeaders()))
        xhr.setRequestHeader(key, value);
      xhr.send(data);
    } catch (error) {
      finishReject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
export async function downloadWorkspaceFile(root: string, path: string) {
  const info = await workspaceFileRequest<{ path: string; filename: string }>(
    "download-info",
    { root, path },
  );
  const params = new URLSearchParams({ root, path: info.path });
  const a = document.createElement("a");
  a.href = buildEventUrl("/workspace-files/download?" + params.toString());
  a.download = info.filename || path.split("/").pop() || "download";
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
