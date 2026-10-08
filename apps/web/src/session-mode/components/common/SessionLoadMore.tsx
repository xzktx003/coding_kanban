import { ChevronsDown, Loader2, RotateCw } from "lucide-react";
export function SessionLoadMore({
  loading,
  error,
  onClick,
}: {
  loading: boolean;
  error?: boolean;
  onClick: () => void;
}) {
  const label = loading ? "正在加载…" : error ? "重试加载更多" : "加载更多";
  return (
    <button
      type="button"
      className="session-load-more"
      aria-label={label}
      title={label}
      aria-busy={loading || undefined}
      disabled={loading}
      onClick={onClick}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : error ? (
        <RotateCw size={14} />
      ) : (
        <ChevronsDown size={14} />
      )}
      {(loading || error) && <span>{label}</span>}
    </button>
  );
}
