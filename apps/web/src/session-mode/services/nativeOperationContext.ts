import { getJsonWithOptions } from "./apiAdapt/shared";
import { readWithDeadline } from "./sessionReadQueue";

export interface NativeOperationContext { scopeToken: string; namespace: string }
/** A captured observed runtime/account domain, never a substitute for native authorization. */
export async function readNativeOperationContext(): Promise<NativeOperationContext> {
  const value = await readWithDeadline(signal => getJsonWithOptions<NativeOperationContext>("/lifecycle/context", { suppressToast: true, signal }), 5000);
  if (!value || typeof value.scopeToken !== "string" || !value.scopeToken || value.scopeToken.length > 512 || typeof value.namespace !== "string" || !value.namespace || value.namespace.length > 512) throw new Error("运行服务范围尚未确认，消息未发送，草稿已保留");
  return value;
}
