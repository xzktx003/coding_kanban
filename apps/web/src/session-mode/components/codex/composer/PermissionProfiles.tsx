import { useEffect, useRef, useState } from "react";
import type { PermissionProfileSummary } from "@session/bindings/v2";
import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";
import { DropdownMenuItem } from "@session/components/ui/dropdown-menu";
import { NativeComposerIcon } from "./NativeComposerIcon";

/** Only mounted by an open permission menu; catalogs are capability data, not presets. */
export function PermissionProfiles({
  cwd,
  selected,
  onSelect,
}: {
  cwd: string | null;
  selected?: string | null;
  onSelect: (id: string) => void;
}) {
  const [rows, setRows] = useState<PermissionProfileSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const scope = useRef<ReturnType<typeof captureCodexOperationScope> | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController(),
      captured = captureCodexOperationScope();
    scope.current = captured;
    setLoading(true);
    setError(null);
    setRows([]);
    void readWithDeadline(
      (signal) =>
        postJsonWithOptions<{
          data: PermissionProfileSummary[];
          nextCursor: string | null;
        }>(
          "/api/codex/permissionProfile/list",
          { cwd, cursor, limit: 50 },
          { signal, suppressToast: true },
        ),
      10_000,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!isCodexOperationScopeCurrent(captured))
          throw new Error("账号或运行范围已变化，请重新打开权限菜单");
        if (
          !Array.isArray(result?.data) ||
          result.data.length > 50 ||
          result.data.some(
            (row) =>
              !row ||
              typeof row.id !== "string" ||
              !row.id ||
              row.id.length > 4096 ||
              typeof row.allowed !== "boolean",
          ) ||
          (result.nextCursor !== null && typeof result.nextCursor !== "string")
        )
          throw new Error("权限配置响应无效");
        setRows(result.data);
        setNext(result.nextCursor);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "无法读取权限配置",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      scope.current = null;
    };
  }, [cwd, cursor, retry]);
  return (
    <div className="session-native-permission-profiles">
      <div className="session-native-permission-heading">权限配置</div>
      {loading && (
        <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
          正在读取权限配置…
        </p>
      )}
      {error && (
        <div className="px-3 py-2 text-xs" role="status">
          <p>权限配置暂不可用</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            重试读取
          </button>
        </div>
      )}
      {rows.map((row) => (
        <DropdownMenuItem
          key={row.id}
          role="menuitemradio"
          aria-checked={selected === row.id}
          disabled={!row.allowed}
          title={row.description ?? undefined}
          className="session-native-permission-option"
          onSelect={() => {
            if (
              row.allowed &&
              scope.current &&
              isCodexOperationScopeCurrent(scope.current)
            )
              onSelect(row.id);
          }}
        >
          <NativeComposerIcon name="shield" />
          <span className="session-native-permission-copy">
            <span>{row.id}</span>
            {row.description && <small>{row.description}</small>}
            {!row.allowed && <small>当前策略不允许选择</small>}
          </span>
          {selected === row.id && <NativeComposerIcon name="check" />}
        </DropdownMenuItem>
      ))}
      {next && (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setCursor(next);
          }}
        >
          更多权限配置
        </DropdownMenuItem>
      )}
      {cursor && (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setCursor(null);
          }}
        >
          返回首批权限配置
        </DropdownMenuItem>
      )}
    </div>
  );
}
