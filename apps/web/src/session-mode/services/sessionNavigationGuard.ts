import { create } from "zustand";

type LeaveState = { dirty: boolean; saving: boolean };
type PendingNavigation = { proceed: () => void; cancel?: () => void; origin?: HTMLElement | null };
const guards = new Map<symbol, () => LeaveState>();
export const useSessionNavigationGuard = create<{
  pending: PendingNavigation | null;
  saving: boolean;
  dirty: boolean;
}>(() => ({ pending: null, saving: false, dirty: false }));

export function refreshSessionLeaveGuards() {
  const states = [...guards.values()].map((read) => read());
  useSessionNavigationGuard.setState({
    dirty: states.some((state) => state.dirty),
    saving: states.some((state) => state.saving),
  });
}
export function registerSessionLeaveGuard(read: () => LeaveState) {
  const key = Symbol();
  guards.set(key, read);
  refreshSessionLeaveGuards();
  return () => { guards.delete(key); refreshSessionLeaveGuards(); };
}
export function requestSessionNavigation(proceed: () => void, cancel?: () => void) {
  refreshSessionLeaveGuards();
  const { dirty, saving } = useSessionNavigationGuard.getState();
  if (dirty || saving) useSessionNavigationGuard.setState({ pending: { proceed, cancel, origin: document.activeElement instanceof HTMLElement ? document.activeElement : null } });
  else proceed();
}
export function cancelSessionNavigation() {
  const pending = useSessionNavigationGuard.getState().pending;
  useSessionNavigationGuard.setState({ pending: null });
  pending?.cancel?.();
  requestAnimationFrame(() => {
    if (pending?.origin?.isConnected && !pending.origin.closest("[hidden], [inert]")) pending.origin.focus({ preventScroll: true });
  });
}
export function confirmSessionNavigation() {
  refreshSessionLeaveGuards();
  const { pending, saving } = useSessionNavigationGuard.getState();
  if (saving) return;
  useSessionNavigationGuard.setState({ pending: null });
  pending?.proceed();
}
