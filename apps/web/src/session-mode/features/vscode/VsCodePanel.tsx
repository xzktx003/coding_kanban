import { useEffect, useRef, useState } from "react";
import { Folder, LoaderCircle, Pin, PinOff, RotateCw } from "lucide-react";
import { Button } from "@session/components/ui/button";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useVsCodePanelStore } from "@session/stores/useVsCodePanelStore";
import type { OpenVsCodeWebResponse } from "@agent-orchestrator/shared";
import type { CodexHostOwner } from "@agent-orchestrator/shared";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { activeDraftOwner } from "@session/stores/useInputStore";
import {
  EditorHostBridge,
  codexHostOwnerKey,
} from "@session/features/codex-host/bridge";

const projectName = (path: string) =>
  path.split("/").filter(Boolean).at(-1) ?? path;
function EditorFrame({
  entry,
  active,
  owner,
}: {
  entry: OpenVsCodeWebResponse;
  active: boolean;
  owner: CodexHostOwner | null;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const bridge = useRef<EditorHostBridge | null>(null);
  const ownerKey = owner ? codexHostOwnerKey(owner) : null;
  useEffect(() => {
    if (!loaded || !frame.current || !owner) return;
    const client = new EditorHostBridge(frame.current, owner);
    bridge.current = client;
    void client.start(active);
    return () => {
      client.dispose();
      if (bridge.current === client) bridge.current = null;
    };
    // A captured owner changes the bridge binding, never the editor iframe.
  }, [loaded, ownerKey, attempt]);
  useEffect(() => {
    void bridge.current?.setActive(active);
  }, [active]);
  useEffect(() => {
    if (loaded) return;
    const timer = window.setTimeout(() => setFailed(true), 45_000);
    return () => window.clearTimeout(timer);
  }, [loaded, attempt]);
  return (
    <div
      className="session-editor-frame-wrap"
      hidden={!active}
      inert={!active}
      data-editor-project={entry.workingDirectory}
    >
      {!loaded && (
        <div
          className="session-editor-loading"
          role={failed ? "alert" : "status"}
        >
          {failed ? (
            <>
              <p>编辑器暂时未能加载。</p>
              <Button
                variant="outline"
                onClick={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                重试加载
              </Button>
            </>
          ) : (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              <span>正在加载 VS Code…</span>
            </>
          )}
        </div>
      )}
      <iframe
        ref={frame}
        key={attempt}
        src={entry.url}
        title={`VS Code · ${entry.workingDirectory}`}
        className="session-editor-frame"
        allow="clipboard-read; clipboard-write"
        onLoad={() => {
          setLoaded(true);
          setFailed(false);
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/** One mounted frame per canonical workspace; hiding a tab never disposes it. */
export function VsCodePanel({ active }: { active: boolean }) {
  const cwd = useWorkspaceStore((state) => state.cwd);
  const threadId = useCodexStore((state) => state.currentThreadId);
  const agent = useAgentSettingsStore((state) => state.selectedAgent);
  const { pinnedPath, pin, entries, aliases, errors, loading, ensure } =
    useVsCodePanelStore();
  const path = pinnedPath ?? cwd;
  const key = path ? aliases[path] : undefined;
  const current = key ? entries[key] : undefined;
  const label = current?.workingDirectory ?? path;
  useEffect(() => {
    if (active && path) void ensure(path).catch(() => {});
  }, [active, path, ensure]);
  useEffect(() => {
    // All retained local projects share the same service. Keep it alive even
    // when the user is reading chat or another tool, without reloading frames.
    const timer = window.setInterval(() => {
      const state = useVsCodePanelStore.getState();
      const first = Object.keys(state.entries)[0];
      if (first) void state.ensure(first, true).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const error = path ? errors[path] : undefined;
  return (
    <section className="session-editor-panel" aria-label="VS Code 项目工作区">
      <div className="session-editor-project">
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm" title={label ?? ""}>
          {label ? projectName(label) : "未选择项目"}
        </span>
        <Button
          variant={pinnedPath ? "secondary" : "ghost"}
          size="sm"
          className="session-editor-pin"
          disabled={!path}
          aria-pressed={!!pinnedPath}
          aria-label={
            pinnedPath ? "取消固定项目，跟随当前项目" : "固定当前编辑项目"
          }
          title={pinnedPath ? `已固定：${label}` : "跟随当前项目，点击可固定"}
          onClick={() =>
            pin(pinnedPath ? null : (current?.workingDirectory ?? path))
          }
        >
          {pinnedPath ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5" />
          )}
          {pinnedPath ? "已固定" : "跟随项目"}
        </Button>
      </div>
      {error && (
        <div role="alert" className="session-editor-error">
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!!path && loading[path]}
            onClick={() => path && void ensure(path, true).catch(() => {})}
          >
            <RotateCw className="size-3.5" />
            重新连接
          </Button>
        </div>
      )}
      {!path && (
        <div className="session-editor-empty">
          选择项目后，在这里打开 VS Code。
        </div>
      )}
      {path && !current && !error && (
        <div role="status" className="session-editor-empty">
          <LoaderCircle className="size-4 animate-spin" />
          正在打开 {projectName(path)}…
        </div>
      )}
      <div className="session-editor-frames">
        {Object.entries(entries).map(([project, entry]) => (
          <EditorFrame
            key={project}
            entry={entry}
            active={active && project === key}
            owner={
              agent === "codex" && cwd && (aliases[cwd] ?? cwd) === project
                ? { cwd: project, threadId, draftOwner: activeDraftOwner() }
                : null
            }
          />
        ))}
      </div>
    </section>
  );
}
