import type { ReactNode } from "react";

export function ComposerTargetMeta({
  targetLabel,
}: {
  targetLabel?: ReactNode;
}) {
  if (targetLabel == null) return null;
  return <div className="session-compact-meta">{targetLabel}</div>;
}
