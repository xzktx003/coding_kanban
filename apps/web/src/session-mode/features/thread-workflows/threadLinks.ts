/** Small deep-link primitives stay independent of transcript and Markdown rendering. */
export function makeThreadUrl(
  base: string,
  threadId: string,
  turnId?: string,
): string {
  const url = new URL(base);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "session");
  url.searchParams.set("thread", threadId);
  if (turnId) url.searchParams.set("turn", turnId);
  return url.toString();
}
export function readThreadLink(
  value: string,
): { threadId: string; turnId?: string } | null {
  const url = new URL(
    value,
    typeof window !== "undefined"
      ? window.location.href
      : "https://invalid.example/",
  );
  const threadId = url.searchParams.get("thread");
  if (
    url.searchParams.get("mode") !== "session" ||
    url.searchParams.getAll("thread").length !== 1 ||
    !threadId ||
    threadId.length > 512 ||
    /[\u0000-\u001f]/.test(threadId)
  )
    return null;
  const turnId = url.searchParams.get("turn");
  if (
    url.searchParams.getAll("turn").length > 1 ||
    (turnId !== null &&
      (!turnId.trim() || turnId.length > 512 || /[\u0000-\u001f]/.test(turnId)))
  )
    return null;
  return {
    threadId,
    ...(turnId && turnId.length <= 512 && !/[\u0000-\u001f]/.test(turnId)
      ? { turnId }
      : {}),
  };
}
