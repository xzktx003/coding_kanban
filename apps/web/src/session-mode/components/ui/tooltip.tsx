import {
  sessionPortalContainer,
  useSessionInteractionVisible,
  useSessionPortalDocument,
} from "@session/session-dom";
import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@session/lib/utils";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  hideArrow = false,
  interactive = false,
  ref,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  hideArrow?: boolean;
  interactive?: boolean;
}) {
  // A tooltip opened inside the independent plan window belongs to that
  // window's own root, and the opener's hidden state must not blank it.
  const ownerDocument = useSessionPortalDocument();
  const visible = useSessionInteractionVisible();
  const attach = React.useCallback(
    (node: HTMLDivElement | null) => {
      // Native rich tooltips expose their actual interactive surface. Radix's
      // ordinary tooltip otherwise clones every child into an invisible span.
      if (interactive && node) {
        const hidden = node.querySelector<HTMLSpanElement>(
          'span[role="tooltip"]',
        );
        if (hidden) {
          node.id = hidden.id;
          node.setAttribute("role", "tooltip");
          node.removeAttribute("aria-label");
          hidden.removeAttribute("id");
          hidden.removeAttribute("role");
          hidden.setAttribute("aria-hidden", "true");
        }
      }
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
    [ref, interactive],
  );
  if (!visible && !ownerDocument) return null;

  return (
    <TooltipPrimitive.Portal
      container={sessionPortalContainer(ownerDocument ?? undefined)}
    >
      <TooltipPrimitive.Content
        ref={attach}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className,
        )}
        {...props}
        aria-label={interactive ? "Preview" : props["aria-label"]}
      >
        {children}
        {!hideArrow && (
          <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
