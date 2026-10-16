import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { useCodexStore } from "@session/components/codex/stores";
import { isAgentInteractionVisible } from "@session/session-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { useModels } from "../hooks/useModels";
import { NativeModelTrigger } from "./NativeModelTrigger";
import { NativeComposerIcon } from "./NativeComposerIcon";
import {
  GENERIC_REASONING_OPTIONS,
  nextReasoningEffort,
} from "./ReasoningEffortSelector";
import { nativeReasoningLabel } from "./nativeReasoningLabel";
import { NativeServiceTierControl } from "./NativeServiceTierControl";
import { recentModelConfigs, rememberRecentModel } from "./recentModelConfigs";

// Native impl-517ea8aeeec5 dt(percent): 28px thumb / 2 minus 1px.
const POWER_ENDPOINT_INSET = 13;
const POWER_TRACK_WIDTH = 200;
const POWER_TRAVEL = POWER_TRACK_WIDTH - POWER_ENDPOINT_INSET * 2;
const COMPOSER_SCOPE =
  ".session-codex-composer, .session-composer-sheet.is-full";
const COMPOSER_EDITOR =
  ".session-native-editor-slot [contenteditable=true], .session-rich-draft textarea";
type ComposerFocusTarget = {
  scope: HTMLElement;
  editor: HTMLElement;
  owner: string;
  scopeOwner: string | undefined;
  threadId: string | null;
};

function isVisibleComposerEditor(editor: HTMLElement) {
  if (!editor.isConnected || editor.closest("[hidden], [inert]")) return false;
  const style = editor.ownerDocument.defaultView?.getComputedStyle(editor);
  return (
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.visibility !== "collapse" &&
    editor.getClientRects().length > 0
  );
}

/** Native xma/1d00n simple power view and advanced model radio list. */
export function NativeModelSelector({
  threadId,
  draftOwner,
}: {
  threadId: string | null;
  draftOwner?: string;
}) {
  const settings = useThreadModelSettings(threadId);
  const { openAiModels, providerItems, loading, error, reload } = useModels();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const recent = recentOpen && recentTick >= 0 ? recentModelConfigs() : [];
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedComposer = useRef<ComposerFocusTarget | null>(null);
  const returnComposer = useRef<ComposerFocusTarget | null>(null);
  const openedLayer = useRef<object | null>(null);
  const layerIdentity = openedLayer.current;
  const suppressCloseFocus = useRef(false);
  const keyboardViewFocus = useRef(false);
  const viewReset = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const scopeIdentity = useMemo(() => ({}), [threadId, draftOwner]);
  const currentScope = useRef({
    threadId,
    draftOwner,
    open,
    identity: scopeIdentity,
  });
  currentScope.current = {
    threadId,
    draftOwner,
    open,
    identity: scopeIdentity,
  };
  const powerStatusId = useId();
  useLayoutEffect(() => {
    openedComposer.current = null;
    setOpen(false);
    setAdvanced(false);
    return () => {
      clearTimeout(viewReset.current);
      viewReset.current = undefined;
      openedComposer.current = null;
      returnComposer.current = null;
      openedLayer.current = null;
      keyboardViewFocus.current = false;
      suppressCloseFocus.current = true;
    };
  }, [scopeIdentity]);
  useEffect(() => {
    if (!open) return;
    const focusSelected = advanced && keyboardViewFocus.current;
    keyboardViewFocus.current = false;
    const captured = openedComposer.current;
    const frame = requestAnimationFrame(() => {
      if (
        currentScope.current.identity !== scopeIdentity ||
        !currentScope.current.open
      )
        return;
      if (focusSelected) {
        if (
          !isAgentInteractionVisible() ||
          (captured && !isCurrentComposer(captured))
        )
          return;
        contentRef.current
          ?.querySelector<HTMLElement>(
            '[role="menuitemradio"][aria-checked="true"]:not([data-disabled]):not([aria-disabled="true"])',
          )
          ?.focus();
      } else {
        // Preserve the verified pointer behavior and the existing initial-open
        // behavior; only a keyboard view switch requests the checked row.
        contentRef.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, advanced, scopeIdentity]);
  function isCurrentComposer(target: ComposerFocusTarget) {
    const current = currentScope.current;
    return (
      isAgentInteractionVisible() &&
      current.threadId === target.threadId &&
      useCodexStore.getState().currentThreadId === target.threadId &&
      (current.draftOwner ?? target.scope.dataset.draftOwner) ===
        target.owner &&
      target.scope.dataset.draftOwner === target.scopeOwner &&
      triggerRef.current?.closest(COMPOSER_SCOPE) === target.scope &&
      target.scope.contains(target.editor) &&
      isVisibleComposerEditor(target.editor)
    );
  }
  const model = openAiModels.find(
    (m) => m.id === settings.model || m.model === settings.model,
  );
  const items = providerItems(settings.modelProvider);
  const catalogOptions =
    settings.modelProvider === "openai"
      ? (model?.supportedReasoningEfforts.map((o) => o.reasoningEffort) ?? [])
      : GENERIC_REASONING_OPTIONS;
  const options =
    settings.modelProvider === "openai" && model
      ? catalogOptions
      : GENERIC_REASONING_OPTIONS;
  const effort = settings.reasoningEffort ?? model?.defaultReasoningEffort;
  const position = Math.max(0, options.indexOf(effort!));
  const canAdjust = options.length > 1;
  const label =
    items.find((m) => m.id === settings.model)?.label ??
    settings.model ??
    "自定义模型";
  const choose = (id: string) => {
    const next = nextReasoningEffort(
      settings.modelProvider,
      id,
      settings.reasoningEffort ?? undefined,
      openAiModels,
    );
    if (id !== settings.model) {
      settings.setModel(id);
    }
    if (next) settings.setReasoningEffort(next);
    setAdvanced(true);
    setRecentTick((tick) => tick + 1);
    rememberRecentModel({
      model: id,
      label: items.find((item) => item.id === id)?.label ?? id,
      reasoningEffort: next ?? settings.reasoningEffort,
      serviceTier: settings.serviceTier ?? null,
    });
    const nextModel = openAiModels.find(
      (model) => model.id === id || model.model === id,
    );
    if (
      settings.serviceTier &&
      !nextModel?.serviceTiers?.some((tier) => tier.id === settings.serviceTier)
    )
      settings.setServiceTier(null);
  };
  const selectEffort = (index: number) => {
    const next = options[Math.max(0, Math.min(options.length - 1, index))];
    if (next) settings.setReasoningEffort(next);
    setRecentTick((tick) => tick + 1);
    if (settings.model) {
      rememberRecentModel({
        model: settings.model,
        label,
        reasoningEffort: next ?? null,
        serviceTier: settings.serviceTier ?? null,
      });
    }
  };
  const applyRecent = (item: (typeof recent)[number]) => {
    settings.setModel(item.model);
    if (item.reasoningEffort) settings.setReasoningEffort(item.reasoningEffort);
    settings.setServiceTier?.(item.serviceTier);
    setRecentOpen(false);
    changeOpen(false);
  };
  const dragEffort = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    selectEffort(
      Math.round(
        ((event.clientX - rect.left - POWER_ENDPOINT_INSET) /
          (rect.width - POWER_ENDPOINT_INSET * 2)) *
          (options.length - 1),
      ),
    );
  };
  function changeOpen(value: boolean) {
    clearTimeout(viewReset.current);
    viewReset.current = undefined;
    keyboardViewFocus.current = false;
    if (value) {
      if (!currentScope.current.open) openedLayer.current = {};
      suppressCloseFocus.current = false;
      returnComposer.current = null;
      const scope = triggerRef.current?.closest<HTMLElement>(COMPOSER_SCOPE);
      const owner = draftOwner ?? scope?.dataset.draftOwner;
      const editor = scope
        ? [...scope.querySelectorAll<HTMLElement>(COMPOSER_EDITOR)].find(
            isVisibleComposerEditor,
          )
        : undefined;
      openedComposer.current =
        scope &&
        owner &&
        editor &&
        (scope.dataset.draftOwner === undefined ||
          scope.dataset.draftOwner === owner)
          ? {
              scope,
              owner,
              editor,
              scopeOwner: scope.dataset.draftOwner,
              threadId,
            }
          : null;
      if (!canAdjust) setAdvanced(true);
    } else {
      openedComposer.current = null;
      const identity = scopeIdentity;
      viewReset.current = setTimeout(() => {
        viewReset.current = undefined;
        if (
          currentScope.current.identity === identity &&
          !currentScope.current.open
        )
          setAdvanced(false);
      }, 350);
    }
    setOpen(value);
  }
  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild>
        <NativeModelTrigger ref={triggerRef} />
      </DropdownMenuTrigger>
      {/* Radix 1.1.11 must unmount this layer while it still owns its modal lock. */}
      {open && (
        <DropdownMenuContent
          ref={contentRef}
          className="session-native-model-menu"
          align="end"
          side="top"
          collisionPadding={8}
          sideOffset={4}
          onKeyDownCapture={(event) => {
            const target = event.target;
            if (
              !(target instanceof HTMLElement) ||
              !["Tab", "ArrowDown", "ArrowUp", "Home", "End"].includes(
                event.key,
              )
            )
              return;
            if (
              event.code === "ComposerNavigation" &&
              target.closest("[data-reasoning-slider]")
            )
              return;
            const rows = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[role^="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
              ),
            ].filter(
              (row) => !row.closest('[hidden], [inert], [aria-hidden="true"]'),
            );
            const index = rows.findIndex(
              (row) => row === target || row.contains(target),
            );
            if (index < 0 || rows.length === 0) return;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? rows.length - 1
                  : (index +
                      (event.key === "ArrowUp" ||
                      (event.key === "Tab" && event.shiftKey)
                        ? -1
                        : 1) +
                      rows.length) %
                    rows.length;
            event.preventDefault();
            event.stopPropagation();
            rows[next]?.focus();
          }}
          onEscapeKeyDown={() => {
            // Native hCa returns Escape to its composer; pointer dismissal retains
            // the menu primitive's normal focus behavior.
            returnComposer.current = openedComposer.current;
          }}
          onCloseAutoFocus={(event) => {
            if (
              currentScope.current.identity !== scopeIdentity ||
              openedLayer.current !== layerIdentity ||
              currentScope.current.open
            ) {
              event.preventDefault();
              return;
            }
            const target = returnComposer.current;
            returnComposer.current = null;
            openedComposer.current = null;
            const suppressed = suppressCloseFocus.current;
            suppressCloseFocus.current = false;
            if (suppressed) {
              event.preventDefault();
              return;
            }
            if (!target) return;
            event.preventDefault();
            if (!isCurrentComposer(target)) return;
            target.editor.focus({ preventScroll: true });
          }}
        >
          {advanced || !canAdjust ? (
            <div
              className="session-native-model-list"
              data-model-picker-view="advanced"
            >
              <div className="session-native-model-heading-row">
                <p className="session-native-model-heading">选择模型</p>
                <button
                  type="button"
                  className="session-native-model-search-toggle"
                  aria-label="搜索模型"
                  aria-expanded={searching}
                  onClick={() => setSearching(true)}
                >
                  <Search size={12} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                aria-expanded={recentOpen}
                onClick={() => setRecentOpen((value) => !value)}
              >
                打开最近使用的模型
              </button>
              {recentOpen && (
                <div role="group" aria-label="最近使用的模型">
                  {recent.length === 0 ? (
                    <p role="status">还没有最近使用的模型</p>
                  ) : (
                    recent.map((item) => (
                      <button
                        key={`${item.model}-${item.reasoningEffort ?? ""}-${item.serviceTier ?? ""}`}
                        type="button"
                        onClick={() => applyRecent(item)}
                      >
                        {item.label} ·{" "}
                        {nativeReasoningLabel(item.reasoningEffort)} ·{" "}
                        {item.serviceTier ? "快速" : "标准"}
                      </button>
                    ))
                  )}
                </div>
              )}
              {searching && (
                <input
                  aria-label="搜索或输入模型 ID"
                  placeholder="搜索或输入模型 ID…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
              {loading && <p role="status">正在加载模型…</p>}
              {error && (
                <p role="alert">
                  {error}
                  <button type="button" onClick={() => void reload()}>
                    重试
                  </button>
                </p>
              )}
              {items
                .filter(
                  (item) =>
                    !query ||
                    item.label.toLowerCase().includes(query.toLowerCase()) ||
                    item.id.toLowerCase().includes(query.toLowerCase()),
                )
                .map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    role="menuitemradio"
                    aria-checked={item.id === settings.model}
                    title={item.description}
                    className="session-native-model-option"
                    onSelect={(e) => {
                      e.preventDefault();
                      choose(item.id);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.id === settings.model && (
                      <NativeComposerIcon name="check" />
                    )}
                  </DropdownMenuItem>
                ))}
              {searching &&
                query &&
                !items.some((item) => item.id === query) && (
                  <button
                    type="button"
                    role="option"
                    aria-label={`使用模型 ID：${query}`}
                    onClick={() => settings.setModel(query)}
                  >
                    使用模型 ID：{query}
                  </button>
                )}
              {!items.some((item) => item.id === settings.model) &&
                settings.model && (
                  <DropdownMenuItem
                    role="menuitemradio"
                    aria-checked
                    className="session-native-model-option"
                    onSelect={() => setAdvanced(false)}
                  >
                    {settings.model}
                    <NativeComposerIcon name="check" />
                  </DropdownMenuItem>
                )}
              {!canAdjust && (
                <NativeServiceTierControl model={model} threadId={threadId} />
              )}
            </div>
          ) : (
            <div
              className="session-native-power-view"
              data-model-picker-view="simple"
            >
              <div className="session-native-power-controls">
                <DropdownMenuItem
                  aria-label="选择模型"
                  className="session-native-power-caption"
                  onPointerDown={() => {
                    keyboardViewFocus.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      keyboardViewFocus.current = true;
                  }}
                  onSelect={(e) => {
                    e.preventDefault();
                    setAdvanced(true);
                  }}
                >
                  <span className="session-native-power-caption-content">
                    <span
                      className="session-native-power-effort"
                      data-accent={Boolean(settings.model)}
                      data-maximum={
                        effort === "ultra" && options.includes("ultra")
                      }
                    >
                      {nativeReasoningLabel(effort)}
                    </span>
                    <span className="session-native-power-model">{label}</span>
                    <NativeComposerIcon
                      name="right"
                      className="session-native-power-chevron"
                      width={12}
                      height={12}
                    />
                  </span>
                </DropdownMenuItem>
                <NativeServiceTierControl model={model} threadId={threadId} />
              </div>
              <div
                className="session-native-power-slider"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  dragEffort(e);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                    dragEffort(e);
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
              >
                <div className="session-native-power-track">
                  {options.map((option, index) => (
                    <span
                      key={option}
                      className="session-native-power-dot"
                      style={{
                        left: `${POWER_ENDPOINT_INSET + (index / (options.length - 1)) * POWER_TRAVEL}px`,
                      }}
                    />
                  ))}
                </div>
                <DropdownMenuItem
                  asChild
                  className="p-0 focus:bg-transparent"
                  aria-label="强度"
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  aria-describedby={powerStatusId}
                  data-reasoning-slider
                  onSelect={(event) => event.preventDefault()}
                  onPointerMove={(event) => event.preventDefault()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      returnComposer.current = openedComposer.current;
                      changeOpen(false);
                      return;
                    }
                    const composerNavigation = e.code === "ComposerNavigation";
                    const next =
                      e.key === "ArrowLeft" ||
                      (composerNavigation && e.key === "ArrowUp")
                        ? position - 1
                        : e.key === "ArrowRight" ||
                            (composerNavigation && e.key === "ArrowDown")
                          ? position + 1
                          : null;
                    if (next !== null) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (
                        next >= 0 &&
                        next < options.length &&
                        next !== position
                      )
                        selectEffort(next);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="session-native-power-thumb"
                    style={{
                      left: `calc(${POWER_ENDPOINT_INSET}px + ${(position / (options.length - 1)) * POWER_TRAVEL}px)`,
                    }}
                  />
                </DropdownMenuItem>
              </div>
              <span
                id={powerStatusId}
                role="status"
                aria-live="polite"
                className="sr-only"
              >
                {label} {nativeReasoningLabel(effort)}，第 {position + 1} 项，共{" "}
                {options.length} 项。使用左右方向键调整强度
              </span>
            </div>
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
