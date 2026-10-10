import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ItemGuardianApprovalReviewCompletedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewCompletedNotification";
import { GuardianDenialController } from "./controller";
import { guardianDenialService } from "./service";
const controllers = new Map<string, GuardianDenialController>();
export function useGuardianDenial(
  review: ItemGuardianApprovalReviewCompletedNotification,
) {
  const key = JSON.stringify(review);
  const controller = useMemo(() => {
    let value = controllers.get(key);
    if (!value) {
      let storage: Storage | undefined;
      try {
        storage = window.localStorage;
      } catch {
        /* Browser storage may be disabled. */
      }
      value = new GuardianDenialController(
        review,
        guardianDenialService,
        storage,
      );
      controllers.set(key, value);
    }
    return value;
  }, [key]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  useEffect(() => {
    void controller.load();
  }, [controller]);
  return {
    ...state,
    approve: () => controller.approve(),
    recheck: () => controller.load(),
  };
}
