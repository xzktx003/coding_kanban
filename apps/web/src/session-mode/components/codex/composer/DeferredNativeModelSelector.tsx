import { lazy, Suspense, useState } from "react";
import { activeDraftOwner } from "@session/stores/useInputStore";
import { isSessionInteractionVisible } from "@session/session-dom";
import { OptionalSessionPanel } from "../../layout/OptionalSessionPanel";
import { NativeModelTrigger } from "./NativeModelTrigger";
import { captureCodexOperationScope, type CodexOperationScope } from "@session/services/codexOperationScope";

const Contents = lazy(() => import("./NativeModelSelector").then((module) => ({ default: module.NativeModelSelector })));

/** Preserve the real selected model/effort summary; load picker controls on demand. */
export function DeferredNativeModelSelector(props: { threadId: string | null; draftOwner?: string }) {
  const owner = `${props.threadId ?? ""}\0${props.draftOwner ?? ""}`;
  const [requested, setRequested] = useState<{ owner: string; scope: CodexOperationScope } | null>(null);
  const current = requested?.owner === owner;
  const trigger = <NativeModelTrigger aria-busy={current || undefined} onClick={(event) => {
    if (!isSessionInteractionVisible() || event.currentTarget.closest("[hidden], [inert]") || (props.draftOwner && activeDraftOwner() !== props.draftOwner)) return;
    setRequested({ owner, scope: captureCodexOperationScope() });
  }} />;
  if (!current) return trigger;
  return <OptionalSessionPanel label="模型选择" overlay onClose={() => setRequested(null)}>
    <Suspense fallback={<>{trigger}<div role="status" className="session-optional-panel-error session-optional-panel-overlay"><strong>正在加载模型选择</strong><button type="button" onClick={() => setRequested(null)}>取消打开</button></div></>}>
      <Contents {...props} initiallyOpen initialScope={requested?.scope} />
    </Suspense>
  </OptionalSessionPanel>;
}
