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
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
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
import { RecordSkillDialog } from "./RecordSkillDialog";
import { notifyNativeFilePickerError } from "@session/features/native-notifications/nativeFilePickerError";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { composerDrafts } from "./v2/drafts";
import { OptionalSessionPanel } from "../../layout/OptionalSessionPanel";
const ProjectReferencePicker = lazy(() => import("@session/features/files/ProjectReferencePicker").then((module) => ({ default: module.ProjectReferencePicker })));

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
  const { i18n } = useTranslation();
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
    } catch {
      notifyNativeFilePickerError(i18n?.language ?? "zh");
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
      <span>上传设备文件</span>
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
  onGoal?: () => void;
  actions?: (close: () => void, persistentMenuTrigger: ReactNode) => ReactNode;
  persistentMenu?: (props: {
    triggerContainer: HTMLElement | null;
    close: () => void;
    parentMenuId: string;
  }) => ReactNode;
}

export function ComposerMenu({
  owner,
  onImageFilesSelected,
  onImagesSelected,
  onFilesSelected,
  onInsertMention,
  onGoal,
  actions,
  persistentMenu,
}: ComposerMenuProps) {
  const threadId = useCodexStore((state) => state.currentThreadId);
  const { webSearchRequest, setWebSearch, permissions } = useThreadModelSettings(threadId);
  const { enabled: goalEnabled, setEnabled: setGoalEnabled } =
    useGoalDraft(owner);
  const { t, i18n } = useTranslation("composer");
  const [openState, setOpenState] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [projectReference, setProjectReference] = useState<{ owner: string; root: string } | null>(null);
  const workspaceRoot = useWorkspaceStore((state) => state.cwd);
  const nativeRoot = useCodexStore((state) => state.threads.find((thread) => thread.id === threadId)?.cwd);
  useEffect(() => { setProjectReference(null); }, [owner]);
  const [persistentTarget, setPersistentTarget] =
    useState<HTMLDivElement | null>(null);
  const parentMenuId = useId();
  const actionClosed = useRef(false);
  const closeForAction = () => {
    actionClosed.current = true;
    setOpenState(false);
  };
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
    } catch {
      notifyNativeFilePickerError(i18n?.language ?? "zh");
    }
  };
  useEffect(() => {
    const openPhotos = () => {
      void handleSelectImage();
    };
    window.addEventListener("session-add-photos", openPhotos);
    return () => window.removeEventListener("session-add-photos", openPhotos);
  });

  return (
    <Popover
      open={openState}
      onOpenChange={(next) => {
        if (next) actionClosed.current = false;
        setOpenState(next);
      }}
    >
      <ComposerTooltip label="附加文件" shortcut="@" popupOpen={openState}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="附加文件"
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
        onInteractOutside={(event) => {
          const target = event.detail.originalEvent.target;
          if (
            target instanceof Element &&
            target
              .closest("[data-composer-parent-menu]")
              ?.getAttribute("data-composer-parent-menu") === parentMenuId
          )
            event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (actionClosed.current) event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={handleSelectImage}
          >
            <ImageIcon className="w-4 h-4" />
            <span>附加照片或视频</span>
          </Button>
          {actions?.(
            () => setOpenState(false),
            persistentMenu ? (
              <div className="contents" ref={setPersistentTarget} />
            ) : null,
          )}
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors",
              webSearchRequest && "bg-blue-100 text-blue-900",
            )}
            disabled={!!permissions}
            title={permissions ? "网络策略由所选权限配置管理" : undefined}
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
          <Button
            type="button"
            variant="ghost"
            className="justify-start gap-2 px-2"
            disabled={!(nativeRoot || workspaceRoot)}
            onClick={() => {
              const root = nativeRoot || workspaceRoot;
              if (!root) return;
              closeForAction();
              setProjectReference({ owner, root });
            }}
          >
            <File className="w-4 h-4" />
            <span>引用项目文件/目录</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="justify-start gap-2 px-2 hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => {
              setOpenState(false);
              setRecordOpen(true);
            }}
          >
            <PlusIcon className="w-4 h-4" />
            <span>录制技能</span>
          </Button>
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
              if (onGoal) onGoal();
              else setGoalEnabled(true);
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
      {persistentMenu?.({
        triggerContainer: persistentTarget,
        close: closeForAction,
        parentMenuId,
      })}
      {recordOpen && <RecordSkillDialog onClose={() => setRecordOpen(false)} />}
      {projectReference && projectReference.owner === owner && (
        <OptionalSessionPanel label="项目文件引用" onClose={() => setProjectReference(null)} overlay>
          <Suspense fallback={<div role="status" className="session-optional-panel-error session-optional-panel-overlay">正在读取项目文件…<button type="button" onClick={() => setProjectReference(null)}>取消打开</button></div>}>
            <ProjectReferencePicker owner={projectReference.owner} root={projectReference.root} onSelect={(context) => composerDrafts.add(projectReference.owner, context)} onClose={() => setProjectReference(null)} />
          </Suspense>
        </OptionalSessionPanel>
      )}
    </Popover>
  );
}
