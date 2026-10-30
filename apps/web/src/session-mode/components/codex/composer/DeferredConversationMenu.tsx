import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { activeDraftOwner } from "@session/stores/useInputStore";
import { isSessionInteractionVisible, useSessionInteractionVisible } from "@session/session-dom";
import { matchesSessionShortcut } from "@session/services/sessionKeyboardShortcuts";
import { captureCodexOperationScope, isCodexOperationScopeCurrent, type CodexOperationScope } from "@session/services/codexOperationScope";
import { OptionalSessionPanel } from "../../layout/OptionalSessionPanel";
import { Button } from "../../ui/button";
import { NativeComposerIcon } from "./NativeComposerIcon";

type Props = ComponentProps<typeof import("./ConversationMenu")["ConversationMenu"]>;
type Command = "menu" | "shortcuts" | "search" | "personality";
const Contents = lazy(() => import("./ConversationMenu").then((module) => ({ default: module.ConversationMenu })));

/** Keep public keyboard commands live without loading unopened menu actions. */
export function DeferredConversationMenu(props: Props) {
  const [requested, setRequested] = useState<{ id: number; owner: string; kind: Command; scope: CodexOperationScope } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const nextId = useRef(0);
  const owner = `${props.threadId ?? ""}\0${props.draftOwner ?? ""}`;
  const visible = useSessionInteractionVisible();
  const current = useRef({ props, owner });
  current.current = { props, owner };
  const request = (kind: Command) => setRequested({ id: ++nextId.current, owner, kind, scope: captureCodexOperationScope() });
  useEffect(() => {
    if (loaded || !visible || (!props.ownsGlobalShortcuts && props.triggerContainer === null)) return;
    const ownsInput = () => {
      const { props: active } = current.current;
      return isSessionInteractionVisible() && (!active.ownsGlobalShortcuts || (!!active.composerRef?.current?.isConnected && !active.composerRef.current.closest("[hidden], [inert]") && (!active.draftOwner || activeDraftOwner() === active.draftOwner)));
    };
    const open = (kind: Command) => {
      if (ownsInput()) setRequested({ id: ++nextId.current, owner: current.current.owner, kind, scope: captureCodexOperationScope() });
    };
    const onKey = (event: KeyboardEvent) => {
      if (!ownsInput()) return;
      if (event.target instanceof HTMLElement && (!event.target.closest(".session-mode") || event.target.closest('[role="dialog"], [role="alertdialog"], .session-rich-draft, .session-files-editor'))) return;
      const kind = (["shortcuts", "search", "personality"] as const).find((command) => matchesSessionShortcut(event, command));
      if (!kind) return;
      event.preventDefault();
      event.stopPropagation();
      open(kind);
    };
    const onShortcuts = () => open("shortcuts");
    window.addEventListener("keydown", onKey);
    window.addEventListener("codex-open-keyboard-shortcuts", onShortcuts);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("codex-open-keyboard-shortcuts", onShortcuts);
    };
  }, [loaded, visible, props.ownsGlobalShortcuts, props.triggerContainer]);
  const trigger = <Button type="button" variant="ghost" size={props.variant === "item" ? undefined : "icon"} className={props.variant === "item" ? "justify-start" : undefined} aria-label="当前会话的更多操作" title="当前会话的更多操作" aria-busy={!!requested || undefined} onClick={() => { props.onOpen?.(); request("menu"); }}><NativeComposerIcon name="more" />{props.variant === "item" && "当前会话"}</Button>;
  const placeholder = props.triggerContainer === undefined ? trigger : props.triggerContainer ? createPortal(trigger, props.triggerContainer) : null;
  if (!requested && !loaded) return placeholder;
  return <OptionalSessionPanel label="会话操作" overlay onClose={() => { setRequested(null); setLoaded(false); }}>
    <Suspense fallback={<>{placeholder}<div role="status" className="session-optional-panel-error session-optional-panel-overlay"><strong>正在加载会话操作</strong><button type="button" onClick={() => setRequested(null)}>取消打开</button></div></>}>
      <LoadedMenu {...props} initialCommand={requested?.owner === owner ? requested : undefined} onLoaded={() => setLoaded(true)} />
    </Suspense>
  </OptionalSessionPanel>;
}

function LoadedMenu({ onLoaded, ...props }: Props & { onLoaded: () => void }) {
  useEffect(onLoaded, []);
  return <Contents {...props} initialCommand={props.initialCommand?.kind === "personality" && props.initialCommand.scope && !isCodexOperationScopeCurrent(props.initialCommand.scope) ? undefined : props.initialCommand} />;
}
