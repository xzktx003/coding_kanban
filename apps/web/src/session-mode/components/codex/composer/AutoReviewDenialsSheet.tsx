import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useCodexStore } from "../stores";
import { GuardianDenialController } from "@session/features/guardian-denial/controller";
import { guardianDenialService } from "@session/features/guardian-denial/service";
import { ComposerSheet } from "./v2/ComposerSheet";
import { listAutoReviewDenials } from "./autoReviewDenials";

export function AutoReviewDenialsSheet({
  threadId,
  onClose,
}: {
  threadId: string | null;
  onClose: () => void;
}) {
  const events = useCodexStore(
    useShallow((state) => (threadId ? (state.events[threadId] ?? []) : [])),
  );
  const rows = listAutoReviewDenials(events, threadId);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function approve(reviewId: string) {
    const row = rows.find((item) => item.review.reviewId === reviewId);
    if (!row || busyId) return;
    setBusyId(reviewId);
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    const controller = new GuardianDenialController(
      row.review,
      guardianDenialService,
      storage,
    );
    try {
      await controller.load();
      await controller.approve();
      const state = controller.getState().state;
      if (state === "recorded") {
        toast.success("已记录批准");
        onClose();
        return;
      }
      toast.error("无法记录自动审核批准");
    } catch {
      toast.error("无法记录自动审核批准");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ComposerSheet
      title="批准"
      description="选择一条自动审查驳回记录，以批准一次重试。此次重试仍会经过自动审查。"
      onClose={onClose}
    >
      {rows.length === 0 ? (
        <p role="status">没有可批准的自动审查驳回</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.review.reviewId}>
              <button
                type="button"
                disabled={busyId !== null}
                aria-busy={busyId === row.review.reviewId}
                onClick={() => void approve(row.review.reviewId)}
              >
                <span>{row.title}</span>
                <span>
                  {busyId === row.review.reviewId
                    ? "正在记录批准操作…"
                    : row.rationale}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ComposerSheet>
  );
}
