import { Button } from "@session/components/ui/button";

export function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div role="status" className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-violet-500" />
        <p className="text-sm text-slate-400">正在整理历史用量…</p>
        <p className="mt-2 text-xs text-slate-500">
          首次统计需要读取本机历史，可以先切回会话；后续筛选会复用结果。
        </p>
      </div>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div role="alert" className="text-center">
        <p className="mb-3 text-sm text-red-400">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    </div>
  );
}
