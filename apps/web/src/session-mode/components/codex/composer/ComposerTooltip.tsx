import type { ReactElement } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@session/components/ui/tooltip";
export function ComposerTooltip({
  label,
  shortcut,
  popupOpen = false,
  children,
}: {
  label: string;
  shortcut?: string;
  popupOpen?: boolean;
  children: ReactElement;
}) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200} open={popupOpen ? false : undefined}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          className="session-native-composer-tooltip"
          side="top"
          sideOffset={4}
        >
          <span className="session-native-composer-tooltip-label">
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
