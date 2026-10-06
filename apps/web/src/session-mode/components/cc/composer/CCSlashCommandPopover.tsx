import { useCallback, useEffect, useRef } from "react";
import {
  applyEditorReplacement,
  detectWordBoundaryTrigger,
  replaceAtTrigger,
  useComposerPopover,
} from "@session/components/common/useComposerPopover";
import { TerminalSquare } from "lucide-react";
import { ComposerSuggestionPanel } from "@session/components/codex/composer/ComposerSuggestionPanel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import { ccGetSlashCommands } from "@session/services";
import { useCCStore } from "@session/stores/cc";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";

interface CCSlashCommandPopoverProps {
  input: string;
  setInput: (v: string) => void;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  triggerElement: HTMLElement | null;
}

const detectSlash = detectWordBoundaryTrigger("/");
const filterCmd = (cmd: string, query: string) =>
  !query || cmd.toLowerCase().includes(query.toLowerCase());

export function CCSlashCommandPopover({
  input,
  setInput,
  editorRef,
  triggerElement,
}: CCSlashCommandPopoverProps) {
  const slashCommands = useCCStore((s) => s.slashCommands);
  const setSlashCommands = useCCStore((s) => s.setSlashCommands);
  const cwd = useWorkspaceStore((s) => s.cwd);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot load on mount; the length guard makes any re-run a no-op
  useEffect(() => {
    if (slashCommands.length > 0) return;
    ccGetSlashCommands(cwd || undefined)
      .then(setSlashCommands)
      .catch((err) =>
        console.error(
          "[CCSlashCommandPopover] Failed to load slash commands:",
          err,
        ),
      );
  }, []);

  const handleSelect = useCallback(
    (cmd: string) => {
      const newValue = replaceAtTrigger(input, "/", `/${cmd}`);
      if (newValue !== null)
        applyEditorReplacement(newValue, setInput, editorRef);
      else editorRef.current?.focus();
    },
    [input, setInput, editorRef],
  );

  const {
    open,
    setOpen,
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    itemRefs,
  } = useComposerPopover({
    input,
    items: slashCommands,
    filter: filterCmd,
    detect: detectSlash,
    onKeySelect: handleSelect,
  });

  const triggerRef = useRef<HTMLSpanElement | null>(null);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <span
          ref={(el) => {
            triggerRef.current = el;
            if (el && triggerElement) {
              const rect = triggerElement.getBoundingClientRect();
              el.style.position = "fixed";
              el.style.left = `${rect.left}px`;
              el.style.top = `${rect.top}px`;
              el.style.width = "0";
              el.style.height = "0";
              el.style.pointerEvents = "none";
            }
          }}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(460px,calc(100vw-24px))] border-0 bg-transparent p-0 shadow-none"
        sideOffset={8}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <ComposerSuggestionPanel
          kind="commands"
          count={filteredItems.length}
          style={{
            maxHeight:
              "min(var(--composer-suggestion-height), var(--radix-popover-content-available-height))",
          }}
        >
          {filteredItems.map((cmd, index) => (
            <button
              key={cmd}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              data-selected={index === selectedIndex}
              className="composer-suggestion-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(cmd)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="composer-suggestion-icon" aria-hidden="true">
                <TerminalSquare />
              </span>
              <span className="composer-suggestion-text">
                <span className="composer-suggestion-name composer-suggestion-command">
                  /{cmd}
                </span>
              </span>
            </button>
          ))}
        </ComposerSuggestionPanel>
      </PopoverContent>
    </Popover>
  );
}
