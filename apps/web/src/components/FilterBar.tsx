import type { AgentSessionRecord } from "@agent-orchestrator/shared";

export interface FilterState {
  host: string | null;
  kind: string | null;
  transport: string | null;
  dirQuery: string;
  tag: string | null;
}

interface FilterBarProps {
  sessions: AgentSessionRecord[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export function FilterBar({
  sessions,
  filters,
  onFiltersChange,
}: FilterBarProps) {
  const hosts = Array.from(new Set(sessions.map((s) => s.hostId ?? "local")));
  const kinds = Array.from(new Set(sessions.map((s) => s.agentKind)));
  const transports = sessions.some((s) => s.transportRef?.tmuxSession)
    ? ["tmux"]
    : [];
  const allTags = Array.from(
    new Set(sessions.flatMap((s) => s.tags ?? [])),
  ).sort();
  const hasFilters =
    filters.host || filters.kind || filters.transport || filters.dirQuery || filters.tag;

  return (
    <div className="filter-bar">
      <label className="filter-item">
        <span className="filter-label">服务器</span>
        <select
          className="filter-select"
          value={filters.host ?? ""}
          onChange={(e) =>
            onFiltersChange({ ...filters, host: e.target.value || null })
          }
        >
          <option value="">全部</option>
          {hosts.map((h) => (
            <option key={h} value={h}>
              {h === "local" ? "本地" : h}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-item">
        <span className="filter-label">类型</span>
        <select
          className="filter-select"
          value={filters.kind ?? ""}
          onChange={(e) =>
            onFiltersChange({ ...filters, kind: e.target.value || null })
          }
        >
          <option value="">全部</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-item">
        <span className="filter-label">类别</span>
        <select
          className="filter-select"
          value={filters.transport ?? ""}
          onChange={(e) =>
            onFiltersChange({ ...filters, transport: e.target.value || null })
          }
        >
          <option value="">全部</option>
          {transports.map((transport) => (
            <option key={transport} value={transport}>
              {transport}
            </option>
          ))}
        </select>
      </label>

      {allTags.length > 0 && (
        <label className="filter-item">
          <span className="filter-label">标签</span>
          <select
            className="filter-select"
            value={filters.tag ?? ""}
            onChange={(e) =>
              onFiltersChange({ ...filters, tag: e.target.value || null })
            }
          >
            <option value="">全部</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="filter-item">
        <span className="filter-label">目录</span>
        <input
          className="filter-input"
          placeholder="搜索目录..."
          value={filters.dirQuery}
          onChange={(e) =>
            onFiltersChange({ ...filters, dirQuery: e.target.value })
          }
        />
      </label>

      {hasFilters && (
        <button
          className="filter-reset"
          onClick={() =>
            onFiltersChange({
              host: null,
              kind: null,
              transport: null,
              dirQuery: "",
              tag: null,
            })
          }
        >
          重置筛选
        </button>
      )}
    </div>
  );
}
