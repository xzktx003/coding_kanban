import { useLayoutStore } from "@session/stores";
import {
  useSavedTurnReviewStore,
  type SavedTurnReview,
} from "@session/stores/useSavedTurnReviewStore";

export const toRelativePath = (
  path: string,
  cwd: string | null | undefined,
) => {
  if (!cwd) return path;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
};

export const useOpenReviewTab = (target?: SavedTurnReview) => {
  const { setActiveRightPanelTab, setRightPanelOpen } = useLayoutStore();
  return (path?: string) => {
    if (target) useSavedTurnReviewStore.getState().open(target, path);
    else useSavedTurnReviewStore.getState().close();
    setActiveRightPanelTab("diff");
    setRightPanelOpen(true);
  };
};
