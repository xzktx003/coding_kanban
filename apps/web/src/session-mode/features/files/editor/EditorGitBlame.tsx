import { useEffect, useState } from "react";
import {
  gitBlameLine,
  type GitBlameLine,
} from "@session/services/apiAdapt/git";
import { useEditorStore as useCursorStore } from "@session/stores/EditorStore";
import { useEditorStore } from "@session/stores/useEditorStore";

export function EditorGitBlame({
  cwd,
  filePath,
}: {
  cwd: string;
  filePath: string;
}) {
  const enabled = useEditorStore((state) => state.gitBlame);
  const line =
    (useCursorStore((state) => state.cursorPositions.get(filePath)?.row) ?? 0) +
    1;
  const [blame, setBlame] = useState<GitBlameLine | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const timer = setTimeout(() => {
      void gitBlameLine(cwd, filePath, line)
        .then((next) => {
          if (active) setBlame(next);
        })
        .catch(() => {
          if (active) setBlame(null);
        });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cwd, enabled, filePath, line]);
  if (!enabled) return null;
  return (
    <p role="status" aria-label="Git 追溯信息">
      {!blame
        ? "正在读取追溯…"
        : blame.present
          ? `作者 ${blame.author} · 日期 ${blame.date} · 提交 ${blame.shortHash} ${blame.summary}`
          : "当前行没有提交记录"}
    </p>
  );
}
