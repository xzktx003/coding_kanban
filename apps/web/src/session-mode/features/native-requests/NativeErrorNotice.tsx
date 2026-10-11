import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CodexErrorInfo } from "@session/bindings/v2/CodexErrorInfo";
import { NativeChevronDown } from "@session/components/codex/presentation/NativeIcons";
import {
  nativeErrorParts,
  nativeReconnectProgress,
  nativeRetryIsOverloaded,
} from "./nativeErrorContent";
import "./native-notices.css";

// Enabled VSIX mOi -> mG verticalIcon, c5/Bd exact 16px notice glyph.
function NativeErrorIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 9.8a.767.767 0 1 1 0 1.533A.767.767 0 0 1 8 9.8Zm0-5.134c.368 0 .667.299.667.667V8a.667.667 0 0 1-1.334 0V5.333c0-.368.299-.667.667-.667Z" />
      <path
        fillRule="evenodd"
        d="M8 1.333a6.667 6.667 0 1 1 0 13.334A6.667 6.667 0 0 1 8 1.333Zm0 1.334a5.333 5.333 0 1 0 0 10.666A5.333 5.333 0 0 0 8 2.667Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function NativeErrorNotice({ message }: { message: string }) {
  return (
    <aside role="alert" className="codex-native-error-card">
      <NativeErrorIcon />
      <span className="codex-native-error-content">
        {nativeErrorParts(message).map((part, index) =>
          part.href ? (
            <a key={index} href={part.href} target="_blank" rel="noreferrer">
              {part.text}
            </a>
          ) : (
            part.text
          ),
        )}
      </span>
    </aside>
  );
}

export function NativeRetryNotice({
  message,
  errorInfo,
  additionalDetails,
}: {
  message: string;
  errorInfo?: CodexErrorInfo | null;
  additionalDetails?: string | null;
}) {
  const { t } = useTranslation("thread");
  const [expanded, setExpanded] = useState(false);
  const progress = nativeReconnectProgress(message);
  const summary = nativeRetryIsOverloaded(errorInfo)
    ? t("nativeErrors.busyReconnecting", {
        progress: progress ? ` ${progress}` : "",
        defaultValue: `服务器繁忙，正在重新连接${progress ? ` ${progress}` : ""}`,
      })
    : progress
      ? `Reconnecting ${progress}`
      : message;
  const details = additionalDetails?.trim() ? additionalDetails : null;
  return (
    <div className="codex-native-retry">
      {details ? (
        <button
          type="button"
          aria-label={summary}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span role="status" aria-live="polite">
            {summary}
          </span>
          <NativeChevronDown aria-hidden="true" />
        </button>
      ) : (
        <span role="status" aria-live="polite">
          {summary}
        </span>
      )}
      {details && expanded && <p>{details}</p>}
    </div>
  );
}
