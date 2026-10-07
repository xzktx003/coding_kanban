import { useEffect, useRef, useId } from "react";

import type {
  AgentSessionRecord,
  ScanResult,
} from "@agent-orchestrator/shared";

import { useModalFocusBoundary } from "./modal-focus-boundary";

import type { SelectedHost } from "./HostDropdown";
import { TmuxDiscoveryPanel } from "./TmuxDiscoveryPanel";
import { AppDiscoveryPanel } from "./AppDiscoveryPanel";

export type DiscoveryMode = "tmux" | "apps";

export interface AddToGridItem {
  scanResult: ScanResult;
  tmuxSessionName?: string;
  connectMode?: "direct" | "tmux";
}

interface DiscoveryDialogProps {
  open: boolean;
  mode: DiscoveryMode;
  host: SelectedHost;
  sessions: AgentSessionRecord[];
  onClose: () => void;
  onAddToGrid: (items: AddToGridItem[]) => void;
  onFocusSession: (id: string) => void;
}

function hostDisplayName(host: SelectedHost): string {
  if (host.type === "local") return "本机";
  return host.preset.name ?? host.preset.host;
}

export function DiscoveryDialog({
  open,
  mode,
  host,
  sessions,
  onClose,
  onAddToGrid,
  onFocusSession,
}: DiscoveryDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocusBoundary(open, dialogRef);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const title =
    mode === "tmux"
      ? `发现 tmux 会话 — ${hostDisplayName(host)}`
      : `发现会话 — ${hostDisplayName(host)}`;

  return (
    <div
      className="discovery-overlay"
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="discovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="discovery-dialog-header">
          <h2 id={titleId} className="discovery-dialog-title">
            {title}
          </h2>
          <button
            className="discovery-dialog-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="discovery-dialog-body">
          {mode === "tmux" ? (
            <TmuxDiscoveryPanel
              host={host}
              sessions={sessions}
              onAddToGrid={onAddToGrid}
              onFocusSession={onFocusSession}
            />
          ) : (
            <AppDiscoveryPanel
              host={host}
              sessions={sessions}
              onAddToGrid={onAddToGrid}
              onFocusSession={onFocusSession}
            />
          )}
        </div>
      </div>
    </div>
  );
}
