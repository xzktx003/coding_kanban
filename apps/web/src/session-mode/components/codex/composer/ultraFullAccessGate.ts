import type { ReasoningEffort } from "@session/bindings";
import type { SandboxMode } from "@session/bindings/v2";

/**
 * Original `Lti` (app-initial-fee819fe4f22.js @3221724) commits the model and
 * effort straight away when
 *
 *   `!b || t !== "ultra" || s.reasoningEffort === "ultra"`
 *
 * where `b = f === "full-access" && (_ == null || _.startsWith(":"))`, i.e. the
 * current permission mode is full access and no non-default permission profile
 * is pinned. Only the remaining case awaits the `Pti` dialog.
 *
 * `permissionsKnown` is required because an unconfirmed permission state
 * must not be read as full access, and must not be read as safe either: the
 * gate only fires on an affirmatively known full-access mode, matching how the
 * rest of the composer refuses to render an unknown mode as a definite one.
 */
export function needsUltraFullAccessConfirmation({
  nextEffort,
  currentEffort,
  sandbox,
  permissionsKnown,
  permissionProfile,
}: {
  nextEffort: ReasoningEffort;
  currentEffort: ReasoningEffort | null | undefined;
  sandbox: SandboxMode | null | undefined;
  permissionsKnown: boolean;
  permissionProfile?: string | null;
}): boolean {
  if (nextEffort !== "ultra") return false;
  // Already on ultra: raising nothing, so there is no new combination to warn
  // about. This is the official `s.reasoningEffort === "ultra"` arm.
  if (currentEffort === "ultra") return false;
  // Official Lti's condition applies only to the ordinary built-in permission
  // modes. A custom named profile must not inherit a stale sandbox label.
  if (permissionProfile && !permissionProfile.startsWith(":")) return false;
  return permissionsKnown && sandbox === "danger-full-access";
}

/**
 * Original `getNonFullAccessFallbackMode` reads a stored
 * `preferred-non-full-access-agent-mode-by-host-id` preference and returns null
 * when none applies, which is what disables `Continue`.
 *
 * The web client now records an explicit restricted-mode choice per server
 * origin through nonFullAccessPreference; an absent preference stays null.
 */
/** @deprecated Use the host's actual saved restricted-mode preference. */
export const ULTRA_FALLBACK_SANDBOX: SandboxMode | null = null;
