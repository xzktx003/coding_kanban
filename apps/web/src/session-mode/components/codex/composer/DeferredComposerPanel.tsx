import { Suspense, type ReactNode } from "react";
import { OptionalSessionPanel } from "../../layout/OptionalSessionPanel";

/** Optional tools fail locally and never replace the live input owner. */
export function DeferredComposerPanel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return <OptionalSessionPanel label={label} onClose={onClose}>
    <Suspense fallback={<div role="status" className="session-optional-panel-error"><strong>正在加载{label}</strong><button type="button" onClick={onClose}>取消打开</button></div>}>{children}</Suspense>
  </OptionalSessionPanel>;
}
