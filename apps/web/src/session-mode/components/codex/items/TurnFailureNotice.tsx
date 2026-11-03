import type { CodexErrorInfo } from "@session/bindings/v2/CodexErrorInfo";
import {
  NativeErrorNotice,
  NativeRetryNotice,
} from "@session/features/native-requests/NativeErrorNotice";
import { nativeErrorMessage } from "@session/features/native-requests/nativeErrorContent";
import {
  isProviderSafetyBlock,
  PROVIDER_SAFETY_BLOCK_HINT,
} from "@session/services/providerSafetyBlock";

/** A persisted turn can carry its error without replaying an `error` event. */
export function TurnFailureNotice({
  message,
  willRetry = false,
  errorInfo,
  additionalDetails,
}: {
  message?: string;
  willRetry?: boolean;
  errorInfo?: CodexErrorInfo | null;
  additionalDetails?: string | null;
}) {
  const detail = nativeErrorMessage(message);
  if (willRetry)
    return (
      <NativeRetryNotice
        message={detail}
        errorInfo={errorInfo}
        additionalDetails={additionalDetails}
      />
    );
  const oversizedArguments =
    /input\[\d+\]\.arguments/i.test(detail) && /string too long/i.test(detail);
  const safetyBlock = isProviderSafetyBlock(detail, errorInfo);
  return (
    <div className="space-y-2">
      <NativeErrorNotice message={detail} />
      {safetyBlock && (
        <p className="text-sm" data-provider-safety-block>
          {PROVIDER_SAFETY_BLOCK_HINT}
        </p>
      )}
      {oversizedArguments && (
        <details>
          <summary className="cursor-pointer">查看错误详情</summary>
          <p className="mt-2 text-sm">
            历史工具调用参数过长，超过接口限制。需要修复历史上下文后再继续；直接重发同一消息仍可能失败。
          </p>
        </details>
      )}
    </div>
  );
}
