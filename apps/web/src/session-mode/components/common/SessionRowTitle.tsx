import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

export function SessionRowTitle({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <span
            className="session-row-title"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.currentTarget
                  .closest<HTMLElement>(".session-nav-row")
                  ?.click();
              }
            }}
          >
            {title}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="session-row-tooltip max-w-80 break-words whitespace-pre-wrap pointer-events-none"
        >
          {title}
          {detail && `\n${detail}`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
