import { useState } from "react";

import type {
  AgentSessionRecord,
  ScanResult,
} from "@agent-orchestrator/shared";

import {
  scanResultSelectionKey,
  selectedDiscoveryItems,
} from "../lib/discovery-selection";

import { scanDirectory } from "../lib/api";
import { sortScanResults } from "../lib/session-matching";
import type { AddToGridItem } from "./DiscoveryDialog";
import type { SelectedHost } from "./HostDropdown";

function findDirectExistingSession(
  result: ScanResult,
  sessions: AgentSessionRecord[],
): AgentSessionRecord | undefined {
  if (result.sessionId) {
    return sessions.find(
      (session) => session.agentSessionId === result.sessionId,
    );
  }

  const hostId = result.sshTarget?.host ?? "local";
  return sessions.find(
    (session) =>
      (session.hostId ?? "local") === hostId &&
      !session.transportRef?.tmuxSession &&
      session.workingDirectory === result.workingDirectory &&
      session.agentKind === result.agentKind,
  );
}

function findTmuxExistingSession(
  result: ScanResult,
  sessions: AgentSessionRecord[],
): AgentSessionRecord | undefined {
  if (!result.tmuxSession) {
    return undefined;
  }

  const hostId = result.sshTarget?.host ?? "local";
  return sessions.find(
    (session) =>
      (session.hostId ?? "local") === hostId &&
      session.transportRef?.tmuxSession === result.tmuxSession,
  );
}

function buildAddItem(
  result: ScanResult,
  connectMode: "direct" | "tmux",
): AddToGridItem {
  return {
    scanResult: result,
    tmuxSessionName: result.tmuxSession,
    connectMode,
  };
}

interface AppDiscoveryPanelProps {
  host: SelectedHost;
  sessions: AgentSessionRecord[];
  onAddToGrid: (items: AddToGridItem[]) => void;
  onFocusSession: (id: string) => void;
}

function groupByDirectory(results: ScanResult[]): Map<string, ScanResult[]> {
  const groups = new Map<string, ScanResult[]>();
  for (const r of results) {
    const dir = r.workingDirectory || "~";
    const list = groups.get(dir) ?? [];
    list.push(r);
    groups.set(dir, list);
  }
  return groups;
}

export function AppDiscoveryPanel({
  host,
  sessions,
  onAddToGrid,
  onFocusSession,
}: AppDiscoveryPanelProps) {
  const [scanPath, setScanPath] = useState("~");
  const [results, setResults] = useState<ScanResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    if (!scanPath.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const hostId = host.type === "ssh" ? host.preset.host : undefined;
      const sshTarget =
        host.type === "ssh"
          ? {
              host: host.preset.host,
              port: host.preset.port,
              username: host.preset.username,
              identityFile: host.preset.identityFile,
            }
          : undefined;
      const res = await scanDirectory({
        path: scanPath.trim(),
        hostId,
        sshTarget,
      });
      setResults(sortScanResults(res.results));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setLoading(false);
    }
  }

  const filtered = results.filter((r) => {
    if (kindFilter && r.agentKind !== kindFilter) return false;
    if (showOnlyNew) {
      const directExisting = findDirectExistingSession(r, sessions);
      const tmuxExisting = findTmuxExistingSession(r, sessions);
      if (r.tmuxSession) {
        if (directExisting && tmuxExisting) return false;
      } else if (directExisting) {
        return false;
      }
    }
    return true;
  });

  const kinds = [...new Set(results.map((r) => r.agentKind))];
  const groups = groupByDirectory(filtered);

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleAddSelected() {
    const toAdd: AddToGridItem[] = [];
    for (const r of selectedDiscoveryItems(
      results,
      selected,
      scanResultSelectionKey,
    )) {
      const directExisting = findDirectExistingSession(r, sessions);
      if (directExisting) continue;
      toAdd.push(buildAddItem(r, "direct"));
    }
    if (toAdd.length > 0) onAddToGrid(toAdd);
  }

  return (
    <div className="app-discovery-panel">
      <div className="discovery-toolbar">
        <input
          type="text"
          className="discovery-path-input"
          placeholder="扫描路径（如 ~/Projects）"
          value={scanPath}
          onChange={(e) => setScanPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleScan();
          }}
        />
        <button
          className="discovery-scan-btn"
          onClick={handleScan}
          disabled={loading}
        >
          {loading ? "扫描中..." : "扫描"}
        </button>
      </div>

      {results.length > 0 && (
        <div className="discovery-filter-bar">
          <select
            className="discovery-kind-filter"
            value={kindFilter ?? ""}
            onChange={(e) => setKindFilter(e.target.value || null)}
          >
            <option value="">全部类型</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <label className="discovery-checkbox-label">
            <input
              type="checkbox"
              checked={showOnlyNew}
              onChange={(e) => setShowOnlyNew(e.target.checked)}
            />
            仅未加入
          </label>
          <span className="discovery-count">已选 {selected.size} 项</span>
        </div>
      )}

      {error && <div className="discovery-error">{error}</div>}

      {loading && results.length === 0 && (
        <div className="discovery-loading">正在扫描会话...</div>
      )}

      <div className="discovery-list">
        {[...groups.entries()].map(([dir, items]) => (
          <div key={dir} className="discovery-group">
            <div className="discovery-group-title">{dir}</div>
            {items.map((result) => {
              const key = scanResultSelectionKey(result);
              const directExisting = findDirectExistingSession(
                result,
                sessions,
              );
              const tmuxExisting = findTmuxExistingSession(result, sessions);
              const existing = directExisting ?? tmuxExisting;
              const isAlready = Boolean(
                result.tmuxSession
                  ? directExisting && tmuxExisting
                  : directExisting,
              );
              const isChecked = selected.has(key);
              const hasTmux = !!result.tmuxSession;
              const canSelect = !directExisting;

              return (
                <div
                  key={key}
                  className={`discovery-item${isChecked ? " discovery-item--selected" : ""}${isAlready ? " discovery-item--existing" : ""}`}
                >
                  {canSelect && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(key)}
                    />
                  )}
                  <div className="discovery-item-info">
                    <span className="discovery-item-name">
                      {result.displayName}
                    </span>
                    <span className="discovery-item-detail">
                      {result.agentKind} ·{" "}
                      {result.status === "running" ? "运行中" : "已停止"}
                      {hasTmux && (
                        <span className="discovery-recommend-badge">
                          {" "}
                          ╰→ tmux: {result.tmuxSession}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="discovery-item-actions">
                    {hasTmux ? (
                      <>
                        {directExisting ? (
                          <button
                            className="discovery-focus-btn"
                            onClick={() => onFocusSession(directExisting.id)}
                          >
                            聚焦到宫格
                          </button>
                        ) : (
                          <button
                            className="discovery-add-btn"
                            onClick={() =>
                              onAddToGrid([buildAddItem(result, "direct")])
                            }
                          >
                            加入宫格
                          </button>
                        )}
                        {tmuxExisting ? (
                          <button
                            className="discovery-focus-btn"
                            onClick={() => onFocusSession(tmuxExisting.id)}
                          >
                            聚焦 tmux
                          </button>
                        ) : (
                          <button
                            className="discovery-add-btn discovery-add-btn--secondary"
                            onClick={() =>
                              onAddToGrid([buildAddItem(result, "tmux")])
                            }
                          >
                            从 tmux 加入宫格
                          </button>
                        )}
                      </>
                    ) : existing ? (
                      <button
                        className="discovery-focus-btn"
                        onClick={() => onFocusSession(existing.id)}
                      >
                        聚焦到宫格
                      </button>
                    ) : (
                      <button
                        className="discovery-add-btn"
                        onClick={() =>
                          onAddToGrid([buildAddItem(result, "direct")])
                        }
                      >
                        加入宫格
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {filtered.length > 0 && (
        <div className="discovery-footer">
          <span className="discovery-footer-info">
            共 {filtered.length} 个应用
          </span>
          <button
            className="discovery-add-selected-btn"
            onClick={handleAddSelected}
            disabled={selected.size === 0}
          >
            加入已选 ({selected.size})
          </button>
        </div>
      )}
    </div>
  );
}
