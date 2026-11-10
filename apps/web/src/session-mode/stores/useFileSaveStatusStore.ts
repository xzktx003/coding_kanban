import { create } from "zustand";
import { useFileDocumentStore } from "./useFileDocumentStore";

type SaveToken = object;
type PendingOperation = { token: object; isDir: boolean };
interface FileSaveStatus {
  pending: ReadonlyMap<string, SaveToken>;
  failures: ReadonlyMap<string, string>;
  operations: ReadonlyMap<string, PendingOperation>;
}

const createStatusStore = () =>
  create<FileSaveStatus>(() => ({
    pending: new Map(),
    failures: new Map(),
    operations: new Map(),
  }));

// A development update must not forget a write whose HTTP response is pending.
export const useFileSaveStatusStore: ReturnType<typeof createStatusStore> =
  import.meta.hot?.data?.fileSaveStatusStore ?? createStatusStore();
if (import.meta.hot?.data)
  import.meta.hot.data.fileSaveStatusStore = useFileSaveStatusStore;
if (!useFileSaveStatusStore.getState().operations)
  useFileSaveStatusStore.setState({ operations: new Map() });

export function fileOperationContains(
  target: string,
  isDir: boolean,
  path: string,
) {
  const prefix = target.replace(/\/+$/, "") || "/";
  return (
    path === prefix ||
    (isDir && path.startsWith(prefix === "/" ? "/" : prefix + "/"))
  );
}

export function hasPendingFileOperation(
  operations: ReadonlyMap<string, PendingOperation>,
  path: string,
) {
  return Array.from(operations).some(([target, operation]) =>
    fileOperationContains(target, operation.isDir, path),
  );
}

export function beginFileOperation(path: string, isDir: boolean) {
  const store = useFileSaveStatusStore;
  const { pending, operations } = store.getState();
  if (
    Array.from(pending.keys()).some((file) =>
      fileOperationContains(path, isDir, file),
    )
  )
    throw new Error("此位置包含正在保存的文件，请等待保存结果。");
  if (
    Array.from(operations).some(
      ([other, operation]) =>
        fileOperationContains(path, isDir, other) ||
        fileOperationContains(other, operation.isDir, path),
    )
  )
    throw new Error("此位置已有文件操作进行中，请等待结果。");
  const token = {};
  store.setState((state) => ({
    operations: new Map(state.operations).set(path, { token, isDir }),
  }));
  return () => {
    store.setState((state) => {
      if (state.operations.get(path)?.token !== token) return state;
      const operations = new Map(state.operations);
      operations.delete(path);
      return { operations };
    });
  };
}

export function beginFileSave(path: string) {
  const store = useFileSaveStatusStore;
  if (hasPendingFileOperation(store.getState().operations, path))
    throw new Error("文件操作进行中，请等待结果后再保存。");
  if (store.getState().pending.has(path))
    throw new Error("此文件正在保存，请等待当前结果后再试。");
  const token: SaveToken = {};
  store.setState((state) => {
    const pending = new Map(state.pending),
      failures = new Map(state.failures);
    pending.set(path, token);
    failures.delete(path);
    return { pending, failures };
  });
  useFileDocumentStore.getState().markSaveUnconfirmed(path);
  return (result: { ok: true } | { ok: false; error: unknown }) => {
    if (store.getState().pending.get(path) !== token) return;
    store.setState((state) => {
      if (state.pending.get(path) !== token) return state;
      const pending = new Map(state.pending),
        failures = new Map(state.failures);
      pending.delete(path);
      if (!result.ok) {
        const message =
          result.error instanceof Error
            ? result.error.message
            : String(result.error);
        failures.delete(path);
        failures.set(path, message.slice(0, 500) || "未知错误");
        while (failures.size > 64)
          failures.delete(failures.keys().next().value!);
      }
      return { pending, failures };
    });
  };
}

export function clearFileSaveFailure(path: string) {
  useFileSaveStatusStore.setState((state) => {
    if (!state.failures.has(path)) return state;
    const failures = new Map(state.failures);
    failures.delete(path);
    return { failures };
  });
}
