import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MemoryCitation } from "@session/bindings/v2/MemoryCitation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@session/components/ui/tooltip";

/** Native fb/pb/nb: public notes only; memory paths are neither read nor opened. */
export function NativeMemoryCitations({
  citation,
}: {
  citation?: MemoryCitation | null;
}) {
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const touchActivation = useRef(false);
  const touchPinned = useRef(false);
  const dismiss = () => {
    touchPinned.current = false;
    setOpen(false);
  };
  const entries = Array.isArray(citation?.entries)
    ? citation.entries.filter(
        (entry) =>
          entry &&
          typeof entry.path === "string" &&
          entry.path.trim() &&
          typeof entry.note === "string",
      )
    : [];
  if (!entries.length) return null;
  const label = zh
    ? `${entries.length} 条记忆引用`
    : `${entries.length} memory citation${entries.length === 1 ? "" : "s"}`;
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip
        open={open}
        onOpenChange={(next) => {
          // Explicit touch activation is a readable popup. Transcript layout
          // scrolling must not dismiss it before the user can read its notes.
          // Ordinary desktop hover/focus keeps Radix's normal close behavior.
          if (next || !touchPinned.current) setOpen(next);
        }}
      >
        <TooltipTrigger asChild>
          <button
            ref={trigger}
            type="button"
            className="codex-native-memory-citation"
            aria-label={label}
            onPointerDown={(event) => {
              touchActivation.current = event.pointerType === "touch";
              if (touchActivation.current || touchPinned.current)
                event.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              const next = !open;
              touchPinned.current = next && touchActivation.current;
              setOpen(next);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12.002 21L14.0519 20.6581C14.6685 20.5553 15.2376 20.2624 15.6797 19.8203L20.25 15.25C20.9404 14.5596 20.9404 13.4404 20.25 12.75C19.5596 12.0596 18.4404 12.0596 17.75 12.75L13.1806 17.3194C12.738 17.762 12.4449 18.332 12.3424 18.9494L12.002 21Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M8 20.5C6.34315 20.5 5 19.1569 5 17.5V6.5C5 4.84315 6.34315 3.5 8 3.5H17.7C18.418 3.5 19 4.08203 19 4.8V8.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 4V14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent
          className="codex-native-memory-tooltip"
          side="top"
          collisionPadding={8}
          onEscapeKeyDown={dismiss}
          onPointerDownOutside={(event) => {
            if (
              !(event.target instanceof Node) ||
              !trigger.current?.contains(event.target)
            )
              dismiss();
          }}
        >
          <div>{zh ? "引用的记忆" : "Memories cited"}</div>
          <ul>
            {entries.map((entry, index) => (
              <li
                key={`${entry.path}:${entry.lineStart}-${entry.lineEnd}:${index}`}
              >
                {entry.note}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
