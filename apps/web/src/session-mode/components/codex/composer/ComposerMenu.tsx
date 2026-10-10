import {
  open,
  pickBrowserFiles,
  uploadBrowserFile,
} from "@session/browser-dialog";
import {
  Check,
  ChevronRight,
  File,
  Globe,
  Image as ImageIcon,
  PlusIcon,
  Target,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScreenshotPopover } from "@session/components/codex/composer/ScreenshotPopover";
import { useCodexStore } from "@session/components/codex/stores";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { useGoalDraft } from "./goalDrafts";
import { Button } from "@session/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import { Separator } from "@session/components/ui/separator";
import { NativeComposerIcon } from "./NativeComposerIcon";
import type { NativeInputMention } from "@agent-orchestrator/shared";
import { ComposerTooltip } from "./ComposerTooltip";
import { cn } from "@session/lib/utils";
import {
  type MentionItem,
  mentionsWithIcon,
  useMentionItems,
} from "./mentions";

interface SelectFilesMenuItemProps {
  onFilesSelected?: (paths: string[]) => void;
  onAfterSelect?: () => void;
  className?: string;
}

export function SelectFilesMenuItem({
  onFilesSelected,
  onAfterSelect,
  className,
}: SelectFilesMenuItemProps) {
  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
      });

      if (!selected) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      onFilesSelected?.(paths);
      onAfterSelect?.();
    } catch (error) {
      console.error("Failed to select files:", error);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors",
        className,
      )}
      onClick={handleSelectFiles}
    >
      <File className="w-4 h-4" />
      <span>选择文件</span>
    </Button>
  );
}

interface MentionMenuItemProps {
  item: MentionItem;
  onInsert: (text: string, mention?: NativeInputMention) => void;
}

function MentionMenuItem({ item, onInsert }: MentionMenuItemProps) {
  const [promptsOpen, setPromptsOpen] = useState(false);
  const hasPrompts = item.defaultPrompts.length > 0;

  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        className="flex-1 justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors"
        onClick={() => onInsert(item.insertText, item.inputMention)}
      >
        {item.iconSrc && <img src={item.iconSrc} alt="" className="w-4 h-4" />}
        <span className="flex-1 text-left truncate">{item.displayName}</span>
      </Button>
      {hasPrompts && (
        <Popover open={promptsOpen} onOpenChange={setPromptsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-64 max-h-[50vh] overflow-y-auto p-1"
            side="right"
            align="start"
          >
            <div className="flex flex-col gap-1">
              {item.defaultPrompts.map((prompt) => (
                <Button
                  type="button"
                  key={prompt}
                  variant="ghost"
                  className="justify-start gap-2 px-2 h-auto py-1.5 whitespace-normal text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => {
                    setPromptsOpen(false);
                    onInsert(`${item.insertText} ${prompt}`, item.inputMention);
                  }}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export interface ComposerMenuProps {
  owner: string;
  onImageFilesSelected?: (files: File[]) => void;
  onImagesSelected?: (paths: string[]) => void;
  onFilesSelected?: (paths: string[]) => void;
  onInsertMention?: (text: string, mention?: NativeInputMention) => void;
  actions?: (close: () => void) => ReactNode;
}

export function ComposerMenu({
  owner,
  onImageFilesSelected,
  onImagesSelected,
  onFilesSelected,
  onInsertMention,
  actions,
}: ComposerMenuProps) {
  const threadId = useCodexStore((state) => state.currentThreadId);
  const { webSearchRequest, setWebSearch } = useThreadModelSettings(threadId);
  const { enabled: goalEnabled, setEnabled: setGoalEnabled } =
    useGoalDraft(owner);
  const { t } = useTranslation("composer");
  const [openState, setOpenState] = useState(false);
  const { items } = useMentionItems();
  const mentionItems = mentionsWithIcon(items);

  const handleSelectImage = async () => {
    try {
      const selected = await pickBrowserFiles({
        multiple: true,
        accept: "image/*",
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"],
          },
        ],
      });

      if (selected) {
        if (onImageFilesSelected) onImageFilesSelected(selected);
        else
          onImagesSelected?.(
            await Promise.all(selected.map(uploadBrowserFile)),
          );
        setOpenState(false);
      }
    } catch (error) {
      console.error("Failed to select image:", error);
    }
  };

  return (
    <Popover open={openState} onOpenChange={setOpenState}>
      <ComposerTooltip label="添加附件与上下文">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="添加附件与上下文"
            title="添加附件与上下文"
          >
            <NativeComposerIcon name="plus" />
          </Button>
        </PopoverTrigger>
      </ComposerTooltip>
      <PopoverContent
        className="session-composer-menu w-64 max-h-[min(65dvh,480px)] overflow-y-auto p-1"
        side="top"
        collisionPadding={12}
        align="start"
      >
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={handleSelectImage}
          >
            <ImageIcon className="w-4 h-4" />
            <span>上传图片</span>
          </Button>
          {actions?.(() => setOpenState(false))}
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors",
              webSearchRequest && "bg-blue-100 text-blue-900",
            )}
            onClick={() => {
              setWebSearch(!webSearchRequest);
              setOpenState(false);
            }}
          >
            <Globe className="w-4 h-4" />
            <span className="flex-1 text-left">网络搜索</span>
            {webSearchRequest && <Check className="w-4 h-4" />}
          </Button>

          <SelectFilesMenuItem
            onFilesSelected={onFilesSelected}
            onAfterSelect={() => setOpenState(false)}
          />
          {/* Screenshot button */}
          <ScreenshotPopover
            onScreenshotTaken={(path) => {
              if (onImagesSelected) {
                onImagesSelected([path]);
              }
              setOpenState(false);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors",
              goalEnabled && "bg-blue-50 text-blue-700",
            )}
            onClick={() => {
              setGoalEnabled(!goalEnabled);
              setOpenState(false);
            }}
          >
            <Target className="w-4 h-4" />
            <span className="flex-1 text-left">{t("goal")}</span>
          </Button>
          {mentionItems.length > 0 && (
            <>
              <Separator className="my-1" />
              {mentionItems.map((item) => (
                <MentionMenuItem
                  key={item.key}
                  item={item}
                  onInsert={(text, mention) => {
                    onInsertMention?.(text, mention);
                    setOpenState(false);
                  }}
                />
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
