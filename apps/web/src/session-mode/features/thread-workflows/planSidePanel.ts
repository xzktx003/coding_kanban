export interface PlanSidePanelState {
  text: string;
  threadId?: string;
  turnId?: string;
}

type Listener = () => void;
let current: PlanSidePanelState | null = null;
const listeners = new Set<Listener>();

function publish(next: PlanSidePanelState | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

export const planSidePanel = {
  get: () => current,
  open: (state: PlanSidePanelState) => publish({ ...state }),
  close: () => publish(null),
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
