import {
  isSessionGroupCollapsed,
  type SessionGroupState,
} from "./session-groups";

export function shouldPreserveSessionControlKey(
  key: string,
  target: HTMLElement | null,
): boolean {
  return (
    [
      "Tab",
      "Enter",
      " ",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ].includes(key) &&
    Boolean(
      target?.closest(
        'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"]',
      ),
    )
  );
}

export function isSidebarGroupCollapsed(
  groupingEnabled: boolean,
  groupId: string,
  state: SessionGroupState,
  query: string,
): boolean {
  return (
    groupingEnabled && !query.trim() && isSessionGroupCollapsed(state, groupId)
  );
}
