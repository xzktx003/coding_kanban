/** A view-local reveal request; listeners and their body references live on mounted messages. */
export const REVEAL_USER_MESSAGE_EVENT = "codex-reveal-user-message";
export function revealUserMessageContent(root: Element) {
  for (const element of root.querySelectorAll(
    '[data-native-user-message-collapsed="true"]',
  )) {
    const EventConstructor = element.ownerDocument.defaultView?.Event ?? Event;
    element.dispatchEvent(new EventConstructor(REVEAL_USER_MESSAGE_EVENT));
  }
}
