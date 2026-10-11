import { useEffect, useState, type ReactElement } from "react";
import { useSessionInteractionVisible } from "@session/session-dom";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@session/components/ui/tooltip";

/** The ordinary VSIX sE tooltip; composer compact tooltips have a different surface. */
export function NativeMarkdownTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const visible = useSessionInteractionVisible();
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  useEffect(() => {
    if (!open || !visible) return;
    const dismiss = () => setOpen(false);
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [open, visible]);
  return (
    <TooltipProvider>
      <Tooltip
        delayDuration={200}
        open={open && visible}
        onOpenChange={setOpen}
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          className="codex-presentation codex-native-markdown-tooltip"
          side="top"
          sideOffset={2}
          collisionPadding={8}
          hideArrow
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
