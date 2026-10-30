import type { AppSummary, PluginDetail } from "@session/bindings/v2";
import {
  postJsonWithOptions,
  isExplicitRequestRejection,
} from "@session/services/apiAdapt/shared";
import { readNativeOperationContext } from "@session/services/nativeOperationContext";
import { newSessionEditId } from "@session/services/sessionEditIdentity";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import type { PluginRequestTarget } from "./hooks/pluginTargets";
import { capturePluginScope, isPluginScopeCurrent } from "./pluginScope";
import { OperationReceiptJournal } from "@session/services/operationReceiptJournal";
type Saved = {
  operationId: string;
  namespace: string;
  target: PluginRequestTarget;
  operation: "install" | "uninstall";
  status: "accepted" | "state-confirmed" | "unknown" | "rejected";
  at?: number;
};
const identity = (target: PluginRequestTarget) =>
  JSON.stringify([
    target.marketplacePath ?? null,
    target.remoteMarketplaceName ?? null,
    target.pluginName,
  ]);
function validReceipt(value: unknown): Saved {
  const row = value as Partial<Saved> | null;
  const text = (value: unknown, max = 512): value is string =>
    typeof value === "string" &&
    !!value &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value);
  const target = row?.target;
  if (
    !row ||
    !text(row.operationId, 128) ||
    !text(row.namespace) ||
    !target ||
    !text(target.pluginName) ||
    (target.marketplacePath !== null &&
      (typeof target.marketplacePath !== "string" ||
        !target.marketplacePath.startsWith("/") ||
        !text(target.marketplacePath, 4096))) ||
    (target.remoteMarketplaceName !== null &&
      !text(target.remoteMarketplaceName)) ||
    Number(target.marketplacePath !== null) +
      Number(target.remoteMarketplaceName !== null) !==
      1 ||
    !["install", "uninstall"].includes(String(row.operation)) ||
    !["accepted", "state-confirmed", "unknown", "rejected"].includes(
      String(row.status),
    ) ||
    (row.at !== undefined && (!Number.isSafeInteger(row.at) || row.at < 0))
  )
    throw new Error("插件操作回执损坏，请先核对");
  return row as Saved;
}
const journal = new OperationReceiptJournal<Saved>(
  "kanban.session.plugin-mutations.v1",
  (row) => row.operationId,
  validReceipt,
  (left, right) =>
    left.namespace === right.namespace &&
    left.operation === right.operation &&
    identity(left.target) === identity(right.target),
);

export type PluginOperationResult = {
  operationId: string;
  sourceOperationId?: string;
  operation?: "install" | "uninstall";
  status: Saved["status"];
  appsNeedingAuth: AppSummary[];
  plugin?: PluginDetail;
  error?: string;
  authPolicy?: "ON_INSTALL" | "ON_USE";
};
export async function performPluginOperation(
  target: PluginRequestTarget,
  operation: "install" | "uninstall",
  inspectOnly = false,
) {
  const scope = capturePluginScope(),
    context = await readNativeOperationContext();
  if (!isPluginScopeCurrent(scope))
    throw new Error("插件账号或连接已变化，操作未发送");
  const previous = journal
    .read()
    .find(
      (row) =>
        row.namespace === context.namespace &&
        identity(row.target) === identity(target) &&
        row.status === "unknown",
    );
  const intent: Saved = previous ?? {
    target,
    operation,
    operationId: newSessionEditId(),
    namespace: context.namespace,
    status: "unknown",
  };
  if (!previous && !inspectOnly) journal.save(intent);
  let value: PluginOperationResult;
  try {
    value = await readWithDeadline(
      (signal) =>
        postJsonWithOptions<PluginOperationResult>(
          "/api/codex/plugin/mutation",
          {
            target,
            operation: previous?.operation ?? operation,
            operationId: intent.operationId,
            expectedScope: context.scopeToken,
            ...(inspectOnly || previous ? { inspectOnly: true } : {}),
          },
          { signal, suppressToast: true },
        ),
      30000,
    );
    if (
      !value ||
      value.operationId !== intent.operationId ||
      !["accepted", "state-confirmed", "unknown", "rejected"].includes(
        value.status,
      ) ||
      !Array.isArray(value.appsNeedingAuth)
    )
      throw new Error("插件操作回执无效，请核对状态，不要重复安装");
    if (previous || !inspectOnly)
      journal.save({ ...intent, status: value.status });
  } catch (error) {
    if (!previous && !inspectOnly && isExplicitRequestRejection(error))
      journal.save({ ...intent, status: "rejected" });
    throw error;
  }
  if (!isPluginScopeCurrent(scope))
    throw new Error("插件账号或连接已变化；原操作回执已保留，请重新核对");
  return value;
}
export async function readPluginAuthentication(
  target: PluginRequestTarget,
  appIds: string[],
) {
  const scope = capturePluginScope(),
    context = await readNativeOperationContext();
  if (!isPluginScopeCurrent(scope)) throw new Error("插件账号或连接已变化");
  const value = await readWithDeadline(
    (signal) =>
      postJsonWithOptions<{
        apps: Array<{ id: string; isAccessible: boolean | null }>;
      }>(
        "/api/codex/plugin/authentication",
        { target, appIds, expectedScope: context.scopeToken },
        { signal, suppressToast: true },
      ),
    15000,
  );
  if (!isPluginScopeCurrent(scope)) throw new Error("插件账号或连接已变化");
  return value;
}
