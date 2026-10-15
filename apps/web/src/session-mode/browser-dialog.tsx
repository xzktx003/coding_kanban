import { createRoot } from "react-dom/client";
import { useState } from "react";
import { BrowserProjects } from "./features/ProjectSelector";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { readWithDeadline } from "./services/sessionReadQueue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

export interface DialogOptions {
  directory?: boolean;
  multiple?: boolean;
  defaultPath?: string;
  title?: string;
  /** Native browser accept value, useful for mobile photo pickers. */
  accept?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

function showDialog(
  render: (finish: (value: string | null) => void) => React.ReactNode,
): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    (document.querySelector(".session-mode") ?? document.body).append(host);
    const root = createRoot(host);
    let finished = false;
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      resolve(value);
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    root.render(render(finish));
  });
}

export async function uploadBrowserFile(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("附件大小不能超过 10 MB");
  try {
    return await readWithDeadline(async (signal) => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        let settled = false;
        const finish = (error?: unknown, value?: string) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", cancel);
          reader.onload = reader.onerror = reader.onabort = null;
          if (error !== undefined) reject(error);
          else resolve(value!);
        };
        const cancel = () => {
          finish(signal.reason);
          reader.abort();
        };
        signal.addEventListener("abort", cancel, { once: true });
        reader.onerror = () => finish(new Error("无法读取附件"));
        reader.onabort = () => finish(new Error("附件读取已中断，请重试"));
        reader.onload = () =>
          finish(undefined, String(reader.result).split(",")[1]);
        try {
          reader.readAsDataURL(file);
        } catch (error) {
          finish(error);
        }
      });
      const response = await fetch("/api/session/files/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, data }),
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "附件上传失败");
      return result.path;
    }, 30_000);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error("附件上传超时，原文件已保留，请重试或移除附件");
    throw error;
  }
}

/** Open synchronously in the user gesture; uploading belongs to the captured draft. */
export function pickBrowserFiles(
  options: DialogOptions = {},
): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.dataset.filePicker = "browser";
    input.multiple = Boolean(options.multiple);
    input.accept =
      options.accept ??
      options.filters
        ?.flatMap((filter) =>
          filter.extensions.map((extension) => `.${extension}`),
        )
        .join(",") ??
      "";
    input.hidden = true;
    input.tabIndex = -1;
    const finish = (files: File[] | null) => {
      input.remove();
      resolve(files);
    };
    input.oncancel = () => finish(null);
    input.onchange = () => finish(Array.from(input.files ?? []));
    (document.querySelector(".session-mode") ?? document.body).append(input);
    input.click();
  });
}

export async function open(
  options: DialogOptions = {},
): Promise<string | string[] | null> {
  if (options.directory)
    return showDialog((finish) => (
      <Dialog
        open
        onOpenChange={(value) => {
          if (!value) finish(null);
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>{options.title ?? "选择项目目录"}</DialogTitle>
          </DialogHeader>
          <BrowserProjects
            cwd={options.defaultPath ?? useWorkspaceStore.getState().cwd}
            onAddProject={finish}
          />
        </DialogContent>
      </Dialog>
    ));
  const files = await pickBrowserFiles(options);
  if (!files) return null;
  const paths = await Promise.all(files.map(uploadBrowserFile));
  return options.multiple ? paths : (paths[0] ?? null);
}

function SaveDialog({
  initial,
  title,
  finish,
}: {
  initial: string;
  title: string;
  finish: (value: string | null) => void;
}) {
  const [path, setPath] = useState(initial);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) finish(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <label>
          保存到服务端路径
          <input
            className="session-save-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <button
          className="session-dialog-confirm"
          disabled={!path.trim()}
          onClick={() => finish(path.trim())}
        >
          保存
        </button>
      </DialogContent>
    </Dialog>
  );
}

export function save(options: DialogOptions = {}): Promise<string | null> {
  const initial =
    options.defaultPath ?? `${useWorkspaceStore.getState().cwd ?? ""}/plan.md`;
  return showDialog((finish) => (
    <SaveDialog
      initial={initial}
      title={options.title ?? "保存文件"}
      finish={finish}
    />
  ));
}
