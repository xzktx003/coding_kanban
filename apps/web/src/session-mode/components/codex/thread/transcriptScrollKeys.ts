/** Native transcript navigation keys; editor/consumer ownership is checked here. */
export function isTranscriptScrollKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
    return false;
  if (
    event.target instanceof Element &&
    event.target.closest(
      'input, textarea, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return false;
  return [
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
  ].includes(event.key);
}
