/** Explicit browser-window scope; ordinary pages keep their existing keys. */
export const SESSION_WINDOW_PARAMETER = "sessionWindow";
export function sessionWindowId(): string | null {
  if (typeof window === "undefined") return null;
  const values = new URLSearchParams(window.location.search).getAll(
    SESSION_WINDOW_PARAMETER,
  );
  return values.length === 1 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      values[0],
    )
    ? values[0]
    : null;
}
export function hasSessionWindowRoute(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has(SESSION_WINDOW_PARAMETER)
  );
}
export function sessionWindowStorageName(name: string): string {
  const id = sessionWindowId();
  return id ? `${name}.window.${id}` : name;
}
export function sessionWindowDraftOwner(owner: string): string {
  const id = sessionWindowId();
  return id ? JSON.stringify(["window", id, owner]) : owner;
}
