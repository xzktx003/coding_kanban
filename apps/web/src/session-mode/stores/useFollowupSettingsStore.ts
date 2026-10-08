import { create } from "zustand";
import { persist } from "zustand/middleware";
export type EnterBehavior = "enter" | "cmdIfMultiline" | "cmdAlways";
interface FollowupSettings {
  mode: "queue" | "steer";
  enterBehavior: EnterBehavior;
  reviewDelivery: "inline" | "detached";
  setMode(mode: "queue" | "steer"): void;
  setEnterBehavior(value: EnterBehavior): void;
  setReviewDelivery(value: "inline" | "detached"): void;
}
export const useFollowupSettingsStore = create<FollowupSettings>()(
  persist(
    (set) => ({
      mode: "queue",
      enterBehavior: "enter",
      reviewDelivery: "inline",
      setMode: (mode) => set({ mode }),
      setEnterBehavior: (enterBehavior) => set({ enterBehavior }),
      setReviewDelivery: (reviewDelivery) => set({ reviewDelivery }),
    }),
    { name: "kanban.session.followup-settings" },
  ),
);
