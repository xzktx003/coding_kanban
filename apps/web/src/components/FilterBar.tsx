import type { AgentSessionRecord } from "@agent-orchestrator/shared";

export interface FilterState {
  host: string | null;
  kind: string | null;
  transport: string | null;
  dirQuery: string;
  /** Unified overview search, independent of the existing directory filter. */
  query?: string;
  tag: string | null;
}

export function matchesSessionFilters(
  session: AgentSessionRecord,
  filters: FilterState,
): boolean {
  if (filters.host && (session.hostId ?? "local") !== filters.host)
    return false;
  if (filters.kind && session.agentKind !== filters.kind) return false;
  if (filters.transport === "tmux" && !session.transportRef?.tmuxSession)
    return false;
  if (
    filters.dirQuery &&
    !(session.workingDirectory ?? "")
      .toLocaleLowerCase()
      .includes(filters.dirQuery.toLocaleLowerCase())
  )
    return false;
  if (filters.tag && !(session.tags ?? []).includes(filters.tag)) return false;
  const query = filters.query?.trim().toLocaleLowerCase();
  if (!query) return true;
  return [
    session.displayName,
    session.agentKind,
    session.workingDirectory,
    session.hostId,
    ...(session.tags ?? []),
  ].some((value) => value?.toLocaleLowerCase().includes(query));
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
    filters.host ||
    filters.kind ||
    filters.transport ||
    filters.dirQuery ||
    filters.query?.trim() ||
    filters.tag;

  return (
    <div className="filter-bar" role="search" aria-label="查找会话">
      <label className="filter-item filter-item--search">
        <span className="filter-label">搜索</span>
        <input
          className="filter-input"
          type="search"
          placeholder="会话名称、类型或路径"
          value={filters.query ?? ""}
          onChange={(event) =>
            onFiltersChange({ ...filters, query: event.target.value })
          }
        />
      </label>
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
              query: "",
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
