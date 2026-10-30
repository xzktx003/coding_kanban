import type { SandboxMode } from "@session/bindings/v2";
// A device preference for this browser's server origin, never a permission grant.
// Only an actual explicit restricted-mode choice creates it. An absent or
// unreadable preference leaves Ultra's restricted Continue unavailable.
const key = "session-preferred-non-full-access-mode-v1";
export function preferredNonFullAccessMode(): SandboxMode | null {
  try {
    const mode: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return mode === "read-only" || mode === "workspace-write" ? mode : null;
  } catch {
    return null;
  }
}
export function rememberNonFullAccessMode(mode: SandboxMode): void {
  if (mode === "danger-full-access") return;
  try {
    localStorage.setItem(key, JSON.stringify(mode));
  } catch {
    /* No fallback can be claimed if it was not saved. */
  }
}
