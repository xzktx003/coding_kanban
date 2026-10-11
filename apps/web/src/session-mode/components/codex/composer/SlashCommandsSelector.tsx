import { useShallow } from "zustand/react/shallow";
import {
  Activity,
  Brain,
  Download,
  FilePlus2,
  Gauge,
  MessageSquarePlus,
  Minimize2,
  ScanSearch,
  Split,
  Workflow,
} from "lucide-react";
import { ComposerSuggestionPopover } from "./ComposerSuggestionPanel";
import { useCallback, useState } from "react";
import { ConfirmDialog } from "@session/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { useCodexStore } from "@session/components/codex/stores";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import type { ComposerEditorRef } from "@session/components/common/useComposerPopover";
import {
  applyEditorReplacement,
  detectWordBoundaryTrigger,
  replaceAtTrigger,
  useComposerPopover,
} from "@session/components/common/useComposerPopover";
import { codexService } from "@session/services/codexService";
import { useMentionItems, type MentionItem } from "./mentions";
import {
  SLASH_COMMANDS,
  slashCommandDescription,
  type SlashCommand,
  type SlashDialog,
} from "./slashCommands";

const commandIcons = {
  model: Gauge,
  effort: Gauge,
  plan: Workflow,
  status: Activity,
  side: Split,
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
  const { currentThreadId } = useCodexStore(
    useShallow((s) => ({ currentThreadId: s.currentThreadId })),
  );
  const { collaborationMode } = useThreadModelSettings(currentThreadId);
  const { items: mentions } = useMentionItems();
  const { open, query, filteredItems, selectedIndex, setSelectedIndex, itemRefs } =
    useComposerPopover({
      input,
      items: SLASH_COMMANDS,
      filter: filterCmd,
      detect: detectSlash,
      onKeySelect: (cmd) => void handleSelect(cmd),
    });
  const needle = query.toLowerCase();
  const skills = mentions.filter(
    (item) =>
      item.kind === "skill" &&
      (!needle || item.searchTerms.some((term) => term.includes(needle))),
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

  const insertSkill = (skill: MentionItem) => {
    const cleaned = replaceAtTrigger(input, "/", skill.insertText) ?? input;
    applyEditorReplacement(cleaned, setInputValue, editorRef);
  };

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
      count={filteredItems.length + skills.length}
    >
      {filteredItems.length > 0 && (
        <p className="composer-suggestion-group">斜杠命令</p>
      )}
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
                <span className="composer-suggestion-title">{cmd.title}</span>
              </span>
              <span className="composer-suggestion-description">
                {slashCommandDescription(cmd, collaborationMode)}
              </span>
            </span>
          </button>
        );
      })}
      {skills.length > 0 && <p className="composer-suggestion-group">技能</p>}
      {skills.map((skill) => (
        <button
          key={skill.key}
          type="button"
          role="option"
          className="composer-suggestion-option"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insertSkill(skill)}
        >
          <span className="composer-suggestion-icon" aria-hidden="true">
            <Workflow />
          </span>
          <span className="composer-suggestion-text">
            <span className="composer-suggestion-name">
              {skill.insertText}
              <span className="composer-suggestion-title">
                {skill.displayName}
              </span>
            </span>
            {skill.description && (
              <span className="composer-suggestion-description">
                {skill.description}
              </span>
            )}
          </span>
          <span className="composer-suggestion-tag">技能</span>
        </button>
      ))}
    </ComposerSuggestionPopover>
  );
}

// Keep old name exported for any remaining references
export { SlashCommandPopover as SlashCommandsSelector };
