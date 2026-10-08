import { useShallow } from "zustand/react/shallow";
import {
  Brain,
  Download,
  FilePlus2,
  MessageSquarePlus,
  Minimize2,
  ScanSearch,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ComposerSuggestionPopover } from "./ComposerSuggestionPanel";
import { useCallback, useState } from "react";
import { ConfirmDialog } from "@session/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { useCodexStore } from "@session/components/codex/stores";
import type { ComposerEditorRef } from "@session/components/common/useComposerPopover";
import {
  applyEditorReplacement,
  detectWordBoundaryTrigger,
  replaceAtTrigger,
  useComposerPopover,
} from "@session/components/common/useComposerPopover";
import { codexService } from "@session/services/codexService";
import {
  SLASH_COMMANDS,
  type SlashCommand,
  type SlashDialog,
} from "./slashCommands";

const commandIcons = {
  review: ScanSearch,
  compact: Minimize2,
  init: FilePlus2,
  memories: Brain,
  hooks: Workflow,
  import: Download,
  new: MessageSquarePlus,
};
const detectSlash = detectWordBoundaryTrigger("/");
const filterCmd = (cmd: SlashCommand, query: string) =>
  cmd.id.startsWith(query.toLowerCase());

interface SlashCommandPopoverProps {
  input: string;
  setInputValue: (v: string) => void;
  editorRef: ComposerEditorRef;
  triggerElement: HTMLElement | null;
  onOpenDialog: (dialog: SlashDialog) => void;
}

export function SlashCommandPopover({
  input,
  setInputValue,
  editorRef,
  triggerElement,
  onOpenDialog,
}: SlashCommandPopoverProps) {
  const [pending, setPending] = useState<SlashCommand | null>(null);
  const { t } = useTranslation("thread");
  const { currentThreadId } = useCodexStore(
    useShallow((s) => ({ currentThreadId: s.currentThreadId })),
  );

  const handleSelect = useCallback(
    async (cmd: SlashCommand, confirmed = false) => {
      if (cmd.confirmation && !confirmed) {
        setPending(cmd);
        return;
      }
      setPending(null);
      // Drop the /command text before running it.
      const newValue = replaceAtTrigger(input, "/", "");
      const cleaned = newValue ?? input;
      applyEditorReplacement(cleaned, setInputValue, editorRef);

      try {
        await cmd.run({
          currentThreadId,
          openDialog: onOpenDialog,
          ensureThread: async () => {
            if (currentThreadId) {
              return currentThreadId;
            }
            const thread = await codexService.threadStart();
            return thread.id;
          },
        });
      } catch (error) {
        toast.error(String(error));
      }
    },
    [input, setInputValue, editorRef, currentThreadId, onOpenDialog],
  );

  const { open, filteredItems, selectedIndex, setSelectedIndex, itemRefs } =
    useComposerPopover({
      input,
      items: SLASH_COMMANDS,
      filter: filterCmd,
      detect: detectSlash,
      onKeySelect: handleSelect,
    });

  if (pending)
    return (
      <ConfirmDialog
        isOpen
        title={`运行 /${pending.id}？`}
        description={pending.confirmation!}
        confirmLabel="确认运行"
        onCancel={() => setPending(null)}
        onConfirm={() => void handleSelect(pending, true)}
      />
    );
  if (!open) return null;

  return (
    <ComposerSuggestionPopover
      anchor={triggerElement}
      kind="commands"
      count={filteredItems.length}
    >
      {filteredItems.map((cmd, index) => {
        const Icon =
          commandIcons[cmd.id as keyof typeof commandIcons] ?? Workflow;
        return (
          <button
            key={cmd.id}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            data-selected={index === selectedIndex}
            className="composer-suggestion-option"
            onMouseEnter={() => setSelectedIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => handleSelect(cmd)}
          >
            <span className="composer-suggestion-icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="composer-suggestion-text">
              <span className="composer-suggestion-name composer-suggestion-command">
                /{cmd.id}
              </span>
              <span className="composer-suggestion-description">
                {t(`suggestions.descriptions.${cmd.id}`, {
                  defaultValue: cmd.description,
                })}
              </span>
            </span>
          </button>
        );
      })}
    </ComposerSuggestionPopover>
  );
}

// Keep old name exported for any remaining references
export { SlashCommandPopover as SlashCommandsSelector };
