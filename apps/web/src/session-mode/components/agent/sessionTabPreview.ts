/** A visual snapshot only: it never participates in hit testing or navigation. */
import type { SessionDropTarget } from "./sessionTabDrag";

export function createSessionTabInsertionMarker(source: HTMLElement) {
  const scope = source.closest<HTMLElement>(".session-mode");
  if (!scope) return undefined;
  const element = document.createElement("div");
  element.className = "session-tab-insertion-marker";
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
  scope.appendChild(element);
  return {
    show(target: SessionDropTarget) {
      if (!target.insertion) return;
      element.dataset.groupId = target.groupId;
      element.dataset.position = target.insertion.side;
      element.style.transform = `translate3d(${target.insertion.x - 1.5}px, ${target.insertion.y}px, 0)`;
      element.style.height = `${target.insertion.height}px`;
    },
    destroy() {
      element.remove();
    },
  };
}

export function createSessionTabPreview(
  source: HTMLElement,
  startX: number,
  startY: number,
) {
  const scope = source.closest<HTMLElement>(".session-mode");
  if (!scope) return undefined;
  const bounds = source.getBoundingClientRect();
  const offsetX = startX - bounds.left;
  const offsetY = startY - bounds.top;
  const element = document.createElement("div");
  element.className = "session-tab-drag-preview";
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;
  const snapshot = source.cloneNode(true) as HTMLElement;
  // Avoid duplicate IDs and selectors that identify the real, interactive tab.
  for (const node of [
    snapshot,
    ...snapshot.querySelectorAll<HTMLElement>("*"),
  ]) {
    for (const name of [
      "id",
      "aria-describedby",
      "aria-controls",
      "data-tab-key",
      "data-session-drag-key",
      "data-pointer-source",
      "data-pointer-drop",
    ])
      node.removeAttribute(name);
    node.setAttribute("draggable", "false");
    if (node.matches("button, a, [tabindex]")) node.tabIndex = -1;
  }
  element.appendChild(snapshot);
  scope.appendChild(element);
  return {
    move(x: number, y: number) {
      element.style.transform = `translate3d(${x - offsetX}px, ${y - offsetY}px, 0)`;
    },
    destroy() {
      element.remove();
    },
  };
}
