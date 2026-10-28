// Ordinary Code text from original Pti (26.51007, app-initial @3217222).
// ChatGPT-mode copy and native permission admission are outside this dialog.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SandboxMode } from "@session/bindings/v2";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@session/components/ui/dialog";
import "./native-full-access-confirmation.css";

/**
 * Official `Pti` resolves one of three outcomes, so a boolean cannot carry it:
 * keep full access, step down to the fallback permission mode, or dismiss and
 * apply nothing. `continueWithRestrictedPermissions` is `disabled: !canContinue`,
 * so when no fallback mode exists the dialog says so and only offers the other
 * two outcomes.
 */
export type UltraFullAccessChoice = "full-access" | "fallback" | "dismiss";

// Exact ordinary isCyberModel=false strings; the `codeMode` description pair.
const messages = {
  zh: {
    title: "要在完整访问权限下使用 Ultra 吗？",
    description:
      "同时开启 Ultra 和完整访问权限后，Codex 可以使用扩展推理，并在未经询问的情况下运行命令、使用互联网，以及编辑你电脑上任何位置的文件。你可以切换到权限更受限的模式，或继续使用完整访问权限。",
    noFallbackDescription:
      "同时开启 Ultra 和完整访问权限后，Codex 可以使用扩展推理，并在未经询问的情况下运行命令、使用互联网，以及编辑你电脑上任何位置的文件。当前没有权限更受限的模式可用。",
    continueWithFullAccess: "继续使用完整访问权限",
    continueWithRestrictedPermissions: "继续",
    goBack: "取消",
  },
  en: {
    title: "Use Ultra with Full access?",
    description:
      "With Ultra and Full access on, Codex can use extended reasoning while running commands, using the internet, and editing files anywhere on your computer without asking. Switch to a more restricted permission mode or use Full access.",
    noFallbackDescription:
      "With Ultra and Full access on, Codex can use extended reasoning while running commands, using the internet, and editing files anywhere on your computer without asking. No more restricted permission mode is currently available.",
    continueWithFullAccess: "Use Full access",
    continueWithRestrictedPermissions: "Continue",
    goBack: "Cancel",
  },
} as const;

function WarningTriangle({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.505 3.645c.657-1.147 2.333-1.147 2.99 0l6.025 10.526c.64 1.119-.176 2.504-1.495 2.504H3.975c-1.319 0-2.135-1.385-1.495-2.504L8.505 3.645Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 7.083v3.334"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M10 13.333h.008"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface NativeUltraFullAccessConfirmationProps {
  open: boolean;
  /** The mode a "继续" would step down to, or null when none is available. */
  fallbackMode: SandboxMode | null;
  onChoose: (choice: UltraFullAccessChoice) => void;
}

export function NativeUltraFullAccessConfirmation({
  open,
  fallbackMode,
  onChoose,
}: NativeUltraFullAccessConfirmationProps) {
  const { i18n } = useTranslation("composer");
  // Some isolated callers mock only t; keep their defined zh fallback.
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? "zh";
  const text = language.startsWith("zh") ? messages.zh : messages.en;
  const canContinue = fallbackMode != null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onChoose("dismiss");
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="session-native-full-access-overlay"
        className="session-native-full-access-confirmation"
      >
        <form
          className="full-access-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            // Mirrors Pti's `n && (a(), r())`: no fallback mode, no submit.
            if (canContinue) onChoose("fallback");
          }}
        >
          <div className="full-access-section">
            <DialogTitle className="full-access-title">
              <WarningTriangle className="full-access-title-icon" />
              {text.title}
            </DialogTitle>
          </div>
          <div className="full-access-section">
            <DialogDescription className="full-access-description">
              {canContinue ? text.description : text.noFallbackDescription}
            </DialogDescription>
          </div>
          <div className="full-access-section">
            <div className="full-access-footer">
              <button
                type="button"
                className="full-access-cancel"
                onClick={() => onChoose("dismiss")}
              >
                {text.goBack}
              </button>
              <button
                type="button"
                className="full-access-confirm"
                onClick={() => onChoose("full-access")}
              >
                <WarningTriangle className="full-access-confirm-icon" />
                {text.continueWithFullAccess}
              </button>
              <button
                type="submit"
                className="full-access-continue"
                disabled={!canContinue}
              >
                {text.continueWithRestrictedPermissions}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Local resolver semantics match useNativeFullAccessConfirmation. */
export function useNativeUltraFullAccessConfirmation(
  fallbackMode: SandboxMode | null,
) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: UltraFullAccessChoice) => void) | null>(
    null,
  );
  const finish = useCallback((value: UltraFullAccessChoice) => {
    const pending = resolver.current;
    resolver.current = null;
    setOpen(false);
    pending?.(value);
  }, []);
  const ask = useCallback(() => {
    // A second question supersedes the first; the old caller must not hang.
    resolver.current?.("dismiss");
    setOpen(true);
    return new Promise<UltraFullAccessChoice>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  useEffect(
    () => () => {
      resolver.current?.("dismiss");
      resolver.current = null;
    },
    [],
  );
  return {
    ask,
    open,
    confirmation: (
      <NativeUltraFullAccessConfirmation
        open={open}
        fallbackMode={fallbackMode}
        onChoose={finish}
      />
    ),
  };
}
