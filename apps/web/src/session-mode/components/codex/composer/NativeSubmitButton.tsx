import type { ComponentProps } from "react";
import { Button } from "@session/components/ui/button";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { cn } from "@session/lib/utils";

export function NativeSubmitButton({
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button
      {...props}
      className={cn("session-native-submit-button", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <div
        className="session-native-submit-content"
        aria-hidden={loading || undefined}
      >
        {children}
      </div>
      {loading && (
        <div className="session-native-submit-spinner" aria-hidden="true">
          <NativeComposerIcon name="spinner" />
        </div>
      )}
    </Button>
  );
}
