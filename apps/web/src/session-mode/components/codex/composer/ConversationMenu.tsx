import {
  type ComponentProps,
  type RefObject,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Search, List, Download, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { threadAccess } from "@session/services/apiAdapt/codex";
import { codexService } from "@session/services/codexService";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { takeClosedTab } from "@session/stores/closedSessionTabs";
import { sessionTabSelect } from "@session/stores/sessionTabSelect";
import { adjacentFollowedCard, nextAttentionCard } from "./nextAttention";
import { nextRecentViewedCard, recentViewedCards } from "./recentView";
import { usePinStore } from "@session/stores/usePinStore";
import { useLayoutStore } from "@session/stores";
import { useEditorStore } from "@session/stores/useEditorStore";
import { createSideChat } from "@session/services/conversationActions";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import { Button } from "../../ui/button";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { threadWorkflowActions } from "@session/features/thread-workflows/actions";
import { lastAssistantCodeBlock } from "@session/features/thread-workflows/lastCodeBlock";
import { writeNativeMarkdownClipboard } from "../presentation/nativeMarkdownClipboard";
import { useCodexStore } from "../stores/useCodexStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useSessionAttentionStore } from "@session/stores/useSessionAttentionStore";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import {
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import { cycleServiceTier } from "./cycleServiceTier";
import { stepReasoningEffort } from "./cycleReasoningEffort";
import { nativeReasoningLabel } from "./nativeReasoningLabel";
import {
  NATIVE_UNKNOWN_REASONING_OPTIONS,
  nativeReasoningCommand,
  nativeReasoningOptions,
} from "./nativeReasoningOptions";
import { formatDraftRange, type FormatKind } from "./editor/formatSelection";
import { useModelCacheStore } from "../hooks/useModels";
import { getOrdinaryNativePickerModels } from "./ordinaryNativePickerModels";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { activeDraftOwner } from "@session/stores/useInputStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import {
  isAgentInteractionVisible,
  isSessionInteractionVisible,
  sessionPortalContainer,
  useSessionInteractionVisible,
} from "@session/session-dom";
import { SearchChatsSheet } from "./SearchChatsSheet";
import { KeyboardShortcutsSheet } from "./KeyboardShortcutsSheet";
import { requestCanvasPrompt, requestDrawingTool } from "./v2/drawingTool";
import {
  canRedoAppAction,
  canUndoAppAction,
  recordAppAction,
  redoAppAction,
  undoAppAction,
} from "./appActionHistory";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem as PrimitiveMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

import { ConversationOwnerForms } from "./ConversationOwnerForms";
import {
  captureConversationForm,
  type ConversationFormKind,
  type ConversationOwnerForm,
} from "./conversationOwnerFormContext";

const SelectedActionContext = createContext<(() => void) | undefined>(
  undefined,
);
function DropdownMenuItem({
  onSelect,
  ...props
}: ComponentProps<typeof PrimitiveMenuItem>) {
  const complete = useContext(SelectedActionContext);
  return (
    <PrimitiveMenuItem
      {...props}
      onSelect={(event) => {
        onSelect?.(event);
        if (!event.defaultPrevented) complete?.();
      }}
    />
  );
}

type ConversationCopyScope = { current: object | null };
function observeConversationCopy(
  write: Promise<void>,
  scope: ConversationCopyScope,
  owner: object,
  success: string,
  failure: string,
) {
  // Pending clipboard callbacks must not retain this menu's render or source text.
  void write.then(
    () => {
      if (scope.current === owner) toast.success(success);
    },
    () => {
      if (scope.current === owner) toast.error(failure);
    },
  );
}
function copyConversationText(
  text: string,
  scope: ConversationCopyScope,
  success: string,
  failure: string,
) {
  if (scope.current)
    observeConversationCopy(
      writeNativeMarkdownClipboard(text),
      scope,
      scope.current,
      success,
      failure,
    );
}

function applyExpandedList(kind: Extract<FormatKind, "ol" | "ul" | "check">) {
  const field = document.querySelector(
    ".session-composer-sheet.is-full .session-rich-draft textarea[data-draft-start], .session-composer-sheet.is-full .session-rich-draft textarea[data-draft-selection]",
  );
  if (!(field instanceof HTMLTextAreaElement)) {
    toast.message("当前没有打开的页面编辑器");
    return;
  }
  const owner = document
    .querySelector(".session-codex-composer")
    ?.getAttribute("data-draft-owner");
  if (!owner) {
    toast.message("当前输入不属于这个聊天");
    return;
  }
  const marked = field.dataset.draftSelection?.split(":") ?? [];
  const start = Number(marked[0] ?? field.selectionStart);
  const end = Number(marked[1] ?? field.selectionEnd);
  const next = formatDraftRange(field.value, start, end, kind);
  const name = kind === "ol" ? "编号" : kind === "ul" ? "项目符号" : "核对清单";
  if (!next) {
    toast.message(
      kind === "check"
        ? "当前没有可切换核对清单的文本"
        : `当前没有可设置${name}的文本`,
    );
    return;
  }
  useSessionDraftStore.getState().setText(owner, next.value);
  toast.message(kind === "check" ? "已切换核对清单" : `已设置为${name}列表`);
}

export function ConversationMenu({
  threadId,
  draftOwner,
  composerRef,
  title,
  variant = "icon",
  onOpen,
  onRename,
  triggerContainer,
  onActionSelected,
  parentMenuId,
}: {
  threadId: string | null;
  draftOwner?: string;
  composerRef?: RefObject<HTMLElement | null>;
  title: string;
  variant?: "icon" | "item";
  onOpen?: () => void;
  onRename?: () => void;
  triggerContainer?: HTMLElement | null;
  onActionSelected?: () => void;
  parentMenuId?: string;
}) {
  const sessionVisible = useSessionInteractionVisible();
  const copyScope = useRef<object | null>(null);
  useLayoutEffect(() => {
    copyScope.current = {};
    return () => {
      copyScope.current = null;
    };
  }, [threadId, draftOwner]);
  const [menuOpen, setMenuOpen] = useState(false);
  useLayoutEffect(() => {
    if (triggerContainer === null) setMenuOpen(false);
  }, [triggerContainer]);
  const [busy, setBusy] = useState(false);
  const [ownerForm, setOwnerForm] = useState<ConversationOwnerForm | null>(
    null,
  );
  const [searchChats, setSearchChats] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [, setHistoryTick] = useState(0);
  const menuCardId = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modelStatus = useModelCacheStore((state) => state.modelStatus);
  const {
    model,
    modelProvider,
    serviceTier,
    setServiceTier,
    reasoningEffort,
    setReasoningEffort,
    setModelSelection,
    collaborationMode,
    setCollaborationMode,
  } = useThreadModelSettings(threadId);
  const bumpHistory = () => setHistoryTick((tick) => tick + 1);
  const nativeProvider = modelProvider === "openai";
  const reasoningPending = nativeProvider && modelStatus === "pending";
  const isCurrentReasoningOwner = () => {
    if (!isAgentInteractionVisible()) return false;
    // Standalone primitives retain their explicit target; workbench commands
    // additionally require the currently visible Codex input owner.
    const root = sessionPortalContainer();
    if (!root) return composerRef === undefined;
    // A nested Popover portals this trigger out of its Composer. The explicit
    // origin remains authoritative; an empty or detached ref cannot fall back.
    const origin =
      composerRef === undefined ? triggerRef.current : composerRef.current;
    const scope = origin?.closest<HTMLElement>(".session-codex-composer");
    const owner =
      draftOwner ??
      sessionDraftKey("codex", threadId, useWorkspaceStore.getState().cwd);
    // Radix marks the background aria-hidden while this menu is open. Only
    // actual hidden/inert ownership revokes the still-visible portal command.
    if (
      !origin?.isConnected ||
      !scope?.isConnected ||
      scope.closest("[hidden], [inert]")
    ) {
      return false;
    }
    if (scope.closest(".session-mode") !== root) return false;
    return (
      useCodexStore.getState().currentThreadId === threadId &&
      useAgentSettingsStore.getState().selectedAgent === "codex" &&
      !useAcpStore.getState().active &&
      activeDraftOwner() === owner &&
      scope.dataset.draftOwner === owner
    );
  };
  const shiftReasoning = (direction: 1 | -1, wrap: boolean) => {
    if (reasoningPending || !model || !isCurrentReasoningOwner()) return;
    const rawModels = useModelCacheStore.getState().openAiModels;
    const models = nativeProvider
      ? getOrdinaryNativePickerModels(rawModels)
      : rawModels;
    const catalog = models.find(
      (item) => item.model === model || (!nativeProvider && item.id === model),
    );
    const options = catalog
      ? nativeReasoningOptions(catalog)
      : nativeProvider
        ? NATIVE_UNKNOWN_REASONING_OPTIONS
        : [];
    const next = nativeProvider
      ? nativeReasoningCommand(options, reasoningEffort, direction, wrap)
      : stepReasoningEffort([...options], reasoningEffort, direction, wrap);
    if (!next || (!nativeProvider && next === reasoningEffort)) {
      toast.message(
        options.length < 2
          ? "当前模型没有可切换的推理强度"
          : direction > 0
            ? "推理强度已是最高"
            : "推理强度已是最低",
      );
      return;
    }
    if (nativeProvider) {
      setModelSelection({ model, reasoningEffort: next });
    } else {
      setReasoningEffort(next);
    }
    toast.message(`推理强度已设为${nativeReasoningLabel(next)}`);
  };
  useEffect(() => {
    // A persistent owner keeps its forms alive after the parent closes; it does
    // not gain new global shortcut ownership while its entry is absent.
    if (triggerContainer === null || !sessionVisible) return;
    const openShortcuts = () => {
      if (isSessionInteractionVisible()) setShortcutsOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      // Check the actual root before observer/effect cleanup can run.
      if (!isSessionInteractionVisible()) return;
      if (
        event.key !== "/" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".session-mode") === null
      )
        return;
      event.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener("codex-open-keyboard-shortcuts", openShortcuts);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(
        "codex-open-keyboard-shortcuts",
        openShortcuts,
      );
      window.removeEventListener("keydown", onKey);
    };
  }, [triggerContainer, sessionVisible]);
  const cwd = useCodexStore((state) =>
    threadId
      ? state.threads.find((thread) => thread.id === threadId)?.cwd
      : undefined,
  );
  const openOwnerForm = (kind: ConversationFormKind) => {
    if (!threadId) return;
    const thread = useCodexStore
      .getState()
      .threads.find((item) => item.id === threadId);
    try {
      setOwnerForm(
        captureConversationForm(kind, {
          threadId,
          cwd,
          title: thread?.name || thread?.preview || title,
          draftOwner: draftOwner ?? sessionDraftKey("codex", threadId),
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const trigger = (
      <DropdownMenuTrigger asChild>
        {variant === "item" ? (
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            className="justify-start"
            aria-label="当前会话的更多操作"
            onClick={onOpen}
          >
            <NativeComposerIcon name="more" />
            当前会话
          </Button>
        ) : (
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="当前会话的更多操作"
            title="当前会话的更多操作"
          >
            <NativeComposerIcon name="more" />
          </Button>
        )}
      </DropdownMenuTrigger>
  );
  return (
    <SelectedActionContext.Provider value={onActionSelected}>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next);
          if (next)
            menuCardId.current =
              useAgentCenterStore.getState().currentAgentCardId;
        }}
      >
        {triggerContainer === undefined
          ? trigger
          : triggerContainer
            ? createPortal(trigger, triggerContainer)
            : null}
      <DropdownMenuContent
          data-composer-parent-menu={parentMenuId}
        className="session-composer-menu"
        align="end"
        side="top"
        collisionPadding={12}
      >
        <p className="session-conversation-menu-title">{title}</p>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "search")
          }
        >
          <Search size={16} />
          查找聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!cwd}
            onSelect={() => openOwnerForm("fileSearch")}
        >
          <Search size={16} />
          搜索文件
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || !onRename}
          onSelect={() => onRename?.()}
        >
          重命名聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
            onSelect={() => openOwnerForm("archive")}
        >
          归档聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
            onSelect={() => openOwnerForm("delete")}
        >
          删除聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() => {
            if (!threadId) return;
            const thread = useCodexStore
              .getState()
              .threads.find((item) => item.id === threadId);
            const item = {
              kind: "codex" as const,
              id: threadId,
              title: thread?.name || thread?.preview || title || "Codex",
              cwd: thread?.cwd ?? "",
            };
            const wasPinned = usePinStore.getState().isPinned(threadId);
            usePinStore.getState().togglePin(item);
            recordAppAction({
              label: wasPinned ? "取消置顶聊天" : "置顶聊天",
              undo: () => usePinStore.getState().togglePin(item),
              redo: () => usePinStore.getState().togglePin(item),
            });
            bumpHistory();
            toast.message(wasPinned ? "已取消置顶聊天" : "已置顶聊天");
          }}
        >
          置顶/取消置顶聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
            const visible =
                layout.isRightPanelOpen &&
                layout.activeRightPanelTab === "diff";
            const previousOpen = layout.isRightPanelOpen;
            const previousTab = layout.activeRightPanelTab;
            if (visible) layout.setRightPanelOpen(false);
            else {
              layout.setActiveRightPanelTab("diff");
              layout.setRightPanelOpen(true);
            }
            recordAppAction({
              label: visible ? "隐藏“变更”面板" : "显示“变更”面板",
              undo: () => {
                const next = useLayoutStore.getState();
                if (previousTab === null)
                  useLayoutStore.setState({ activeRightPanelTab: null });
                else next.setActiveRightPanelTab(previousTab);
                next.setRightPanelOpen(previousOpen);
              },
              redo: () => {
                const next = useLayoutStore.getState();
                if (visible) next.setRightPanelOpen(false);
                else {
                  next.setActiveRightPanelTab("diff");
                  next.setRightPanelOpen(true);
                }
              },
            });
            bumpHistory();
            toast.message(visible ? "已隐藏“变更”面板" : "已显示“变更”面板");
          }}
        >
          显示/隐藏“变更”面板
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
            const previousOpen = layout.isRightPanelOpen;
            const previousTab = layout.activeRightPanelTab;
            const created = layout.terminals.length === 0;
            if (created) layout.addTerminal();
            const createdTab = created
                ? (useLayoutStore.getState().terminals.at(-1) ?? null)
              : null;
            layout.setActiveRightPanelTab("terminal");
            layout.setRightPanelOpen(true);
            recordAppAction({
              label: "打开终端",
              undo: () => {
                const next = useLayoutStore.getState();
                if (createdTab) next.removeTerminal(createdTab.id);
                if (previousTab === null)
                  useLayoutStore.setState({ activeRightPanelTab: null });
                else next.setActiveRightPanelTab(previousTab);
                next.setRightPanelOpen(previousOpen);
              },
              redo: () => {
                const next = useLayoutStore.getState();
                if (
                  createdTab &&
                  !next.terminals.some((tab) => tab.id === createdTab.id)
                ) {
                  useLayoutStore.setState({
                    terminals: [...next.terminals, createdTab],
                    activeTerminalId: createdTab.id,
                  });
                }
                useLayoutStore.getState().setActiveRightPanelTab("terminal");
                useLayoutStore.getState().setRightPanelOpen(true);
              },
            });
            bumpHistory();
            toast.message("已打开终端");
          }}
        >
          打开终端面板
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.dispatchEvent(new Event("session-open-projects"));
            toast.message("已打开项目选择器");
          }}
        >
          打开项目选择器
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const button = document.querySelector<HTMLButtonElement>(
              '.session-codex-composer button[aria-label="听写"], .session-codex-composer button[aria-label="停止听写"]',
            );
            if (!button) {
              toast.message("当前输入没有听写");
              return;
            }
            const stopping = button.getAttribute("aria-label") === "停止听写";
            button.click();
            toast.message(stopping ? "已停止听写" : "已开始听写");
          }}
        >
          切换语音聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const button = document.querySelector<HTMLButtonElement>(
              '.session-codex-composer button[aria-label="听写"], .session-codex-composer button[aria-label="停止听写"]',
            );
            if (button?.getAttribute("aria-label") !== "停止听写") {
              toast.message("当前没有进行中的听写");
              return;
            }
            button.click();
            toast.message("已将麦克风静音");
          }}
        >
          切换语音聊天麦克风
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("当前听写没有可静音的播放音频");
          }}
        >
          切换语音聊天音频
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const button = document.querySelector<HTMLButtonElement>(
              '.session-codex-composer button[aria-label="停止听写"]',
            );
            if (!button) {
              toast.message("当前没有可结束的听写");
              return;
            }
            button.click();
            toast.message("已结束听写");
          }}
        >
          结束语音聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
            onSelect={() => openOwnerForm("notes")}
        >
          会议：记笔记
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
              const composer = document.querySelector(
                ".session-codex-composer",
              );
            if (!composer) {
              toast.message("当前输入不能添加照片");
              return;
            }
            window.dispatchEvent(new Event("session-add-photos"));
            toast.message("已打开照片选择");
          }}
        >
          添加照片
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
              const composer = Array.from(
                document.querySelectorAll<HTMLElement>(
                  ".session-codex-composer",
                ),
              ).find(
                (element) =>
                  !element.closest("[hidden]") &&
                  (threadId
                ? element.dataset.ownerThread === threadId
                    : Boolean(draftOwner) &&
                      !element.dataset.ownerThread &&
                      element.dataset.draftOwner === draftOwner),
              );
              const button = composer?.querySelector<HTMLButtonElement>(
                'button[aria-label="发送消息"]',
              );
            if (!button || button.disabled) {
              toast.message("当前输入没有可发送的消息");
              return;
            }
            button.click();
            toast.message("已在后台发送消息");
          }}
        >
          在后台发送消息
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const shown = document
              .querySelector(".session-native-model-label")
              ?.textContent?.trim();
            const models = useModelCacheStore.getState().openAiModels;
            const catalog =
              models.find(
                  (item) => item.id === model || item.model === model,
                ) ??
                models.find(
                  (item) =>
                    item.displayName === shown ||
                    item.model === shown ||
                    item.id === shown,
              );
              const next = cycleServiceTier(
                catalog?.serviceTiers ?? [],
                serviceTier,
              );
            if (!next) {
              toast.message("当前模型没有可切换的速度");
              return;
            }
            setServiceTier(next.id);
            toast.message(`已切换到${next.label}`);
          }}
        >
          循环切换速度
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() => {
            const next = collaborationMode === "plan" ? "default" : "plan";
            setCollaborationMode(next);
              toast.message(
                next === "plan" ? "已开启规划模式" : "已关闭规划模式",
              );
          }}
        >
          切换规划模式
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const current = useConfigStore.getState().threadCwdMode;
            const next = current === "worktree" ? "local" : "worktree";
            useConfigStore.getState().setThreadCwdMode(next);
            toast.message(
              next === "worktree"
                ? "新任务将使用独立工作树"
                : "新任务将使用本地目录",
            );
          }}
        >
          切换本地/工作树
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={reasoningPending}
          onSelect={() => shiftReasoning(1, false)}
        >
          提高推理强度
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={reasoningPending}
          onSelect={() => shiftReasoning(-1, false)}
        >
          降低推理强度
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={reasoningPending}
          onSelect={() => shiftReasoning(1, true)}
        >
          循环切换推理强度
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("没有可用的远程计算机。新任务仍使用本机");
          }}
        >
          在主机间循环切换
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!cwd) {
              toast.message("当前聊天没有工作目录");
              return;
            }
              openOwnerForm("commitOptions");
          }}
        >
          提交或推送
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!cwd) {
              toast.message("当前聊天没有工作目录");
              return;
            }
              openOwnerForm("pullRequest");
          }}
        >
          创建 PR
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!cwd) {
              toast.message("当前聊天没有工作目录");
              return;
            }
              openOwnerForm("draftPullRequest");
          }}
        >
          创建草稿 PR
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!cwd) {
              toast.message("当前聊天没有工作目录");
              return;
            }
              openOwnerForm("branch");
          }}
        >
          创建分支
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!cwd) {
              toast.message("当前聊天没有工作目录");
              return;
            }
              openOwnerForm("merge");
          }}
        >
          合并 PR
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!cwd) {
              toast.message("当前聊天没有工作目录");
              return;
            }
              openOwnerForm("openPullRequest");
          }}
        >
          在 GitHub 上打开 PR
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const files = useEditorStore.getState();
            if (!cwd) {
              toast.message("当前没有打开的文件");
              return;
            }
            const next = !files.gitBlame;
            files.setGitBlame(next);
            const layout = useLayoutStore.getState();
            layout.setRightPanelOpen(true);
            layout.setActiveRightPanelTab("files");
              toast.message(
                next ? "已显示 Git 追溯信息" : "已隐藏 Git 追溯信息",
              );
          }}
        >
          切换 Git 追溯信息
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("浏览器不能为编辑器捕获应用快照");
          }}
        >
          捕获应用快照
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("当前页面没有可发送的浏览器批注");
          }}
        >
          发送批注
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const card = takeClosedTab();
            if (!card) {
              toast.message("没有可重新打开的标签页");
              return;
            }
              useAgentCenterStore
                .getState()
                .addAgentCard(card, { activate: true });
            void sessionTabSelect(card);
            bumpHistory();
            toast.message("已重新打开标签页");
          }}
        >
          重新打开已关闭的标签页
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canUndoAppAction()}
          onSelect={() => {
            const label = undoAppAction();
            bumpHistory();
            if (label) toast.message(`已撤销${label}`);
          }}
        >
          撤销上一步操作
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canRedoAppAction()}
          onSelect={() => {
            const label = redoAppAction();
            bumpHistory();
            if (label) toast.message(`已重做${label}`);
          }}
        >
          重做上一步操作
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "users")
          }
        >
          <List size={16} />
          用户消息导航
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "export")
          }
        >
          <Download size={16} />
          导出 Markdown
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
              threadId &&
              threadWorkflowActions.request(threadId, "copyMarkdown")
          }
        >
          复制为 Markdown
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
              threadId &&
              threadWorkflowActions.request(threadId, "copyDeeplink")
          }
        >
          复制深层链接
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() => {
            if (!threadId) return;
            const text = lastAssistantCodeBlock(
              useCodexStore.getState().events[threadId] ?? [],
            );
            if (text == null) {
              toast.message("当前聊天没有代码块");
              return;
            }
              copyConversationText(
                text,
                copyScope,
                "已复制最后一个代码块",
                "未能复制代码块",
              );
          }}
        >
          复制最后一个代码块
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() => {
            if (!threadId) return;
            const cwd = useCodexStore
              .getState()
              .threads.find((thread) => thread.id === threadId)?.cwd;
            if (!cwd) {
              toast.message("当前聊天没有工作目录");
              return;
            }
              copyConversationText(
                cwd,
                copyScope,
                "已复制工作目录",
                "未能复制工作目录",
              );
          }}
        >
          复制工作目录
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() => {
            if (!threadId) return;
            const marked = useSessionAttentionStore
              .getState()
              .markUnread("codex", threadId);
              toast.message(
                marked ? "已标记为未读" : "当前聊天没有可标记的回复",
              );
          }}
        >
          标记为未读
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() => {
            if (!threadId) return;
            const owner = document
              .querySelector(".session-codex-composer")
              ?.getAttribute("data-draft-owner");
            if (owner !== sessionDraftKey("codex", threadId)) {
              toast.message("当前输入不属于这个聊天");
              return;
            }
            useSessionDraftStore.getState().setText(owner, "");
            toast.message("已清除提示");
          }}
        >
          清除提示
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() => {
            if (!threadId) return;
            const path = useCodexStore
              .getState()
              .threads.find((thread) => thread.id === threadId)?.path;
            if (!path) {
              toast.message("当前聊天没有磁盘路径");
              return;
            }
              copyConversationText(
                path,
                copyScope,
                "已复制对话路径",
                "未能复制对话路径",
              );
          }}
        >
          复制对话路径
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "copyLink")
          }
        >
          <NativeComposerIcon name="link" />
          复制会话链接
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
          onSelect={() => {
            if (!threadId) return;
            setBusy(true);
            void createSideChat(threadId)
              .catch((e) => toast.error(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          <MessagesSquare size={16} />
          侧边聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
          onSelect={() => {
            if (!threadId) return;
            setBusy(true);
            void codexService
              .threadFork(threadId)
              .then((forked) => {
                const title = "分叉聊天";
                  useSessionNameStore
                    .getState()
                    .setName("codex", forked.id, title);
                useCodexStore.setState((state) => ({
                  threads: [
                    { ...forked, name: title, preview: title },
                      ...state.threads.filter(
                        (thread) => thread.id !== forked.id,
                      ),
                  ],
                }));
                const center = useAgentCenterStore.getState();
                if (
                  !center.cards.some(
                    (card) => card.id === forked.id && card.kind === "codex",
                  )
                ) {
                  center.addAgentCard(
                    {
                      kind: "codex",
                      id: forked.id,
                      cwd: forked.cwd,
                      preview: title,
                    },
                    { activate: true },
                  );
                }
                useAgentCenterStore
                  .getState()
                  .setCurrentAgentCardId(forked.id, "codex");
                useCodexStore.getState().setCurrentThreadId(forked.id);
                toast.message("已分叉聊天");
              })
              .catch((error: unknown) => toast.error(String(error)))
              .finally(() => setBusy(false));
          }}
        >
          分叉聊天
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setSearchChats(true)}>
          切换聊天…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
            const next = !layout.isSidebarOpen;
            layout.setSidebarOpen(next);
              if (next)
                window.dispatchEvent(new Event("session-open-projects"));
            toast.message(next ? "已开启活动视图" : "已关闭活动视图");
          }}
        >
          切换活动视图
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const trigger = document.activeElement;
              const focusMain = () =>
                useCodexStore.getState().triggerInputFocus();
            if (trigger instanceof HTMLElement) {
              const observer = new MutationObserver(() => {
                if (document.activeElement !== trigger) return;
                observer.disconnect();
                focusMain();
              });
                observer.observe(trigger, {
                  attributes: true,
                  attributeFilter: ["data-state"],
                });
              window.setTimeout(() => {
                observer.disconnect();
                focusMain();
              }, 300);
            } else focusMain();
            toast.message("已聚焦主聊天输入框");
          }}
        >
          聚焦主聊天输入框
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!threadId) return;
            if (!useSideChatStore.getState().chat) {
              void createSideChat(threadId);
              return;
            }
            const trigger = document.activeElement;
              const focusSide = () =>
                useSideChatStore.getState().requestFocus();
            if (trigger instanceof HTMLElement) {
              const observer = new MutationObserver(() => {
                if (document.activeElement !== trigger) return;
                observer.disconnect();
                focusSide();
              });
              observer.observe(trigger, {
                attributes: true,
                attributeFilter: ["data-state"],
              });
              window.setTimeout(() => {
                observer.disconnect();
                focusSide();
              }, 300);
            } else focusSide();
            toast.message("已打开侧边聊天");
          }}
        >
          打开侧边聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const canvas = document.querySelector(".session-drawing-canvas");
            if (!canvas) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("select");
            toast.message("已选择工件");
          }}
        >
          工件：选择
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const canvas = document.querySelector(".session-drawing-canvas");
            if (!canvas) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("hand");
            toast.message("已切换为平移工件");
          }}
        >
          工件：平移
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!document.querySelector(".session-drawing-canvas")) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestCanvasPrompt(null);
            toast.message("已打开画布提示");
          }}
        >
          画布：询问 ChatGPT
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!document.querySelector(".session-drawing-canvas")) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("rect");
            toast.message("已切换为矩形");
          }}
        >
          工件：矩形
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!document.querySelector(".session-drawing-canvas")) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("ellipse");
            toast.message("已切换为圆形");
          }}
        >
          工件：圆形
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!document.querySelector(".session-drawing-canvas")) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("arrow");
            toast.message("已切换为箭头");
          }}
        >
          工件：箭头
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!document.querySelector(".session-drawing-canvas")) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("line");
            toast.message("已切换为直线");
          }}
        >
          工件：直线
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!document.querySelector(".session-drawing-canvas")) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("text");
            toast.message("已切换为文本");
          }}
        >
          工件：文本
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (!document.querySelector(".session-drawing-canvas")) {
              toast.message("当前没有打开的工件画布");
              return;
            }
            requestDrawingTool("comment");
            toast.message("已切换为便签");
          }}
        >
          工件：便签
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const link = window.location.href;
              copyConversationText(
                link,
                copyScope,
                "已复制页面链接",
                "未能复制页面链接",
              );
          }}
        >
          复制页面链接
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const trigger = document.activeElement;
            const focusContent = () => {
              const editor = document.querySelector(
                ".session-composer-sheet.is-full textarea, .session-composer-sheet.is-full [contenteditable='true']",
              );
              const control = document.querySelector(
                ".session-composer-sheet.is-full .session-rich-tools button",
              );
                if (
                  !(editor instanceof HTMLElement) ||
                  !(control instanceof HTMLElement)
                ) {
                toast.message("当前没有打开的页面编辑器");
                return;
              }
              control.focus();
              toast.message("已聚焦内容控件");
            };
            if (trigger instanceof HTMLElement) {
              const observer = new MutationObserver(() => {
                if (document.activeElement !== trigger) return;
                observer.disconnect();
                focusContent();
              });
              observer.observe(trigger, {
                attributes: true,
                attributeFilter: ["data-state"],
              });
              window.setTimeout(() => {
                observer.disconnect();
                focusContent();
              }, 300);
            } else focusContent();
          }}
        >
          将焦点移至内容控件
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => applyExpandedList("ol")}>
          编号列表
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => applyExpandedList("ul")}>
          项目符号列表
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => applyExpandedList("check")}>
          核对清单
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("本机没有与 Dot 的对话");
          }}
        >
          打开您的 Dot
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.setTimeout(() => {
              const card = nextAttentionCard(
                menuCardId.current ??
                  useAgentCenterStore.getState().currentAgentCardId,
              );
              if (!card) {
                toast.message("没有需关注的聊天");
                return;
              }
              void sessionTabSelect(card);
              toast.message("已切换到下一个需关注的聊天");
            }, 0);
          }}
        >
          下一个需关注的聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.setTimeout(() => {
                const currentId =
                  useAgentCenterStore.getState().currentAgentCardId;
              const card = adjacentFollowedCard(-1, currentId);
              if (!card) {
                toast.message("没有上一个聊天");
                return;
              }
                useAgentCenterStore
                  .getState()
                  .setCurrentAgentCardId(card.id, card.kind);
              void sessionTabSelect(card);
              toast.message("已切换到上一个聊天");
            }, 50);
          }}
        >
          上一个聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.setTimeout(() => {
                const currentId =
                  useAgentCenterStore.getState().currentAgentCardId;
              const card = adjacentFollowedCard(1, currentId);
              if (!card) {
                toast.message("没有下一个聊天");
                return;
              }
                useAgentCenterStore
                  .getState()
                  .setCurrentAgentCardId(card.id, card.kind);
              void sessionTabSelect(card);
              toast.message("已切换到下一个聊天");
            }, 50);
          }}
        >
          下一个聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.setTimeout(() => {
              const card = nextRecentViewedCard();
              if (!card) {
                toast.message("没有最近查看的聊天");
                return;
              }
                useAgentCenterStore
                  .getState()
                  .setCurrentAgentCardId(card.id, card.kind);
              void sessionTabSelect(card);
              toast.message("已切换到下一个最近查看的聊天");
            }, 50);
          }}
        >
          下一个最近查看的聊天
        </DropdownMenuItem>
        {[1, 2, 3, 4, 5, 6].map((slot) => (
          <DropdownMenuItem
            key={`recent-${slot}`}
            onSelect={() => {
              window.setTimeout(() => {
                const card = recentViewedCards()[slot - 1];
                if (!card) {
                  toast.message(`最近聊天 ${slot} 还没有会话`);
                  return;
                }
                useAgentCenterStore
                  .getState()
                  .setCurrentAgentCardId(card.id, card.kind);
                void sessionTabSelect(card);
                toast.message(`已打开最近聊天 ${slot}`);
              }, 50);
            }}
          >
            转到最近聊天 {slot}
          </DropdownMenuItem>
        ))}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => (
          <DropdownMenuItem
            key={`tab-${index}`}
            onSelect={() => {
              window.setTimeout(() => {
                const card = useAgentCenterStore.getState().cards[index - 1];
                if (!card) {
                  toast.message(`第 ${index} 个标签页还没有会话`);
                  return;
                }
                useAgentCenterStore
                  .getState()
                  .setCurrentAgentCardId(card.id, card.kind);
                void sessionTabSelect(card);
                toast.message(`已聚焦第 ${index} 个标签页`);
              }, 50);
            }}
          >
            聚焦第 {index} 个标签页
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onSelect={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("mode", "session");
            url.searchParams.set("view", "agent");
            window.location.assign(url.toString());
          }}
        >
          切换到聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("本机没有 ChatGPT 工作模式");
          }}
        >
          切换到工作
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const url = new URL(window.location.href);
            const already =
              url.searchParams.get("mode") === "session" &&
              url.searchParams.get("view") === "agent";
            if (already) {
              toast.message("当前已是 Codex 会话");
              return;
            }
            url.searchParams.set("mode", "session");
            url.searchParams.set("view", "agent");
            window.location.assign(url.toString());
          }}
        >
          切换到 Codex
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("mode", "session");
            url.searchParams.set("view", "settings");
            window.location.assign(url.toString());
          }}
        >
          设置
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.dispatchEvent(new Event("codex-open-mcp"));
          }}
        >
          MCP
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.dispatchEvent(new Event("codex-open-personality"));
          }}
        >
          个性
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("未找到兼容的导入项", {
              description: "后摩智能找不到来自其他编程智能体的兼容数据",
            });
          }}
        >
          从其他 AI 应用导入
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.dispatchEvent(new Event("codex-open-keyboard-shortcuts"));
          }}
        >
          键盘快捷方式
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.dispatchEvent(new Event("codex-open-keyboard-shortcuts"));
          }}
        >
          显示键盘快捷键
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const ids = useAgentCenterStore
              .getState()
              .cards.filter((card) => card.kind === "codex")
              .map((card) => card.id);
              const cleared = useSessionAttentionStore
                .getState()
                .markFollowedRead(ids);
            toast.message(
              cleared > 0 ? "已全部标为已读" : "当前没有未读的关注聊天",
            );
          }}
        >
          全部标为已读
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            useLayoutStore.getState().setView("automations");
          }}
        >
          管理已安排任务
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("无法刷新技能和应用");
          }}
        >
          强制重新加载技能
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            useLayoutStore.getState().setView("plugins");
          }}
        >
          前往技能
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.dispatchEvent(new Event("session-open-projects"));
            toast.message("已打开项目选择器");
          }}
        >
          打开文件夹…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
            const next = !layout.isSidebarOpen;
            layout.setSidebarOpen(next);
            toast.message(next ? "已显示侧边栏" : "已隐藏侧边栏");
          }}
        >
          显示/隐藏侧边栏
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
              const open =
                layout.isRightPanelOpen &&
                layout.activeRightPanelTab === "files";
            if (open) layout.setRightPanelOpen(false);
            else {
              layout.setActiveRightPanelTab("files");
              layout.setRightPanelOpen(true);
            }
            toast.message(open ? "已隐藏导航面板" : "已显示导航面板");
          }}
        >
          显示/隐藏导航面板
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
              const open =
                layout.isRightPanelOpen &&
                layout.activeRightPanelTab === "terminal";
            if (open) layout.setRightPanelOpen(false);
            else {
              layout.setActiveRightPanelTab("terminal");
              layout.setRightPanelOpen(true);
            }
            toast.message(open ? "已隐藏底部面板" : "已显示底部面板");
          }}
        >
          显示/隐藏底部面板
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("当前没有可切换的置顶摘要");
          }}
        >
          显示/隐藏固定摘要
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
            if (layout.terminals.length === 0) layout.addTerminal();
            layout.setActiveRightPanelTab("terminal");
            layout.setRightPanelOpen(true);
            toast.message("已打开终端面板");
          }}
        >
          打开终端
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("本机没有独立完整视图");
          }}
        >
          完整视图
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
            const next = !layout.isRightPanelOpen;
            layout.setRightPanelOpen(next);
            toast.message(next ? "已显示分屏" : "已隐藏分屏");
          }}
        >
          循环切换工作空间布局
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const layout = useLayoutStore.getState();
            layout.setActiveRightPanelTab("diff");
            layout.setRightPanelOpen(true);
            toast.message("已打开“变更”选项卡");
          }}
        >
          打开“变更”选项卡
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("本机没有应用内浏览器标签页");
          }}
        >
          打开浏览器标签页
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const field = document.querySelector<HTMLInputElement>(
              ".session-mode input[aria-label='转到行'], .session-mode input[placeholder='转到行']",
            );
            if (!field) {
              toast.message("当前文件没有转到行");
              return;
            }
            field.focus();
            toast.message("已聚焦转到行");
          }}
        >
          转到行
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.history.back();
          }}
        >
          返回
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.history.forward();
          }}
        >
          前进
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toast.message("本机没有应用内浏览器地址栏");
          }}
        >
          聚焦浏览器地址栏
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "search")
          }
        >
          查找
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            useLayoutStore.getState().setView("settings");
            toast.message("退出登录在设置里");
          }}
        >
          退出登录
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
              window.dispatchEvent(
                new CustomEvent("codex-open-feedback", {
                  detail: {
                    threadId,
                    draftOwner:
                      draftOwner ??
                      sessionDraftKey(
                        "codex",
                        threadId,
                        useWorkspaceStore.getState().cwd,
                      ),
                  },
                }),
              );
          }}
        >
          反馈
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
          onSelect={() => {
            if (!threadId) return;
            setBusy(true);
            void threadAccess(threadId, false)
              .then((access) => {
                const label = {
                  readonly: "本项目未加载此会话，发送时恢复原会话",
                  owned: "本项目保留执行实例",
                  external: "其他客户端占用，历史可读",
                  releasing: "正在等待原生服务确认释放",
                  acquiring: "正在恢复执行实例",
                  unknown: "执行状态尚未确认",
                }[access.state];
                  toast.message(
                    label,
                    access.reason ? { description: access.reason } : undefined,
                  );
              })
              .catch((error) => toast.error(String(error)))
              .finally(() => setBusy(false));
          }}
        >
          查看执行状态
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
          onSelect={() => {
            if (!threadId) return;
            setBusy(true);
            void threadAccess(threadId, true)
              .then((access) => {
                toast.message(
                  access.state === "readonly"
                    ? "本项目已释放执行权"
                    : access.reason || "正在检查释放条件",
                    {
                      description:
                        "仅释放当前会话；已有子 Agent 仍由原运行实例控制。",
                    },
                );
                window.dispatchEvent(new Event("codex-access-changed"));
              })
              .catch((e) => toast.error(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          释放给其他客户端
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {shortcutsOpen && (
      <KeyboardShortcutsSheet onClose={() => setShortcutsOpen(false)} />
    )}
      {searchChats && (
        <SearchChatsSheet onClose={() => setSearchChats(false)} />
    )}
      {ownerForm && (
        <ConversationOwnerForms
          form={ownerForm}
          onClose={() =>
            setOwnerForm((current) =>
              current?.target.id === ownerForm.target.id ? null : current,
            )
          }
          onChange={(next) =>
            setOwnerForm((current) =>
              current?.target.id === ownerForm.target.id ? next : current,
            )
          }
      />
    )}
    </SelectedActionContext.Provider>
  );
}
