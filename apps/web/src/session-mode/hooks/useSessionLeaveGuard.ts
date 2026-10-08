import { useLayoutEffect, useRef } from "react";
import { registerSessionLeaveGuard, refreshSessionLeaveGuards } from "../services/sessionNavigationGuard";

/** Only unsaved, explicitly saved forms register here; chat drafts persist independently. */
export function useSessionLeaveGuard(dirty: boolean, saving = false) {
  const value = useRef({ dirty, saving });
  value.current = { dirty, saving };
  useLayoutEffect(() => registerSessionLeaveGuard(() => value.current), []);
  useLayoutEffect(refreshSessionLeaveGuards, [dirty, saving]);
}
