export function threadFindKeyIntent(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "ctrlKey"
    | "metaKey"
    | "shiftKey"
    | "altKey"
    | "isComposing"
    | "defaultPrevented"
  >,
): "open" | 1 | -1 | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) return null;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "f" && !event.shiftKey)
    return "open";
  if (
    ((event.ctrlKey || event.metaKey) && key === "g") ||
    (key === "f3" && !event.ctrlKey && !event.metaKey)
  )
    return event.shiftKey ? -1 : 1;
  return null;
}
