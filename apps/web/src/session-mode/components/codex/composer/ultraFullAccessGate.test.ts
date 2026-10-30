import { expect, it } from "vitest";
import {
  needsUltraFullAccessConfirmation,
  ULTRA_FALLBACK_SANDBOX,
} from "./ultraFullAccessGate";

/**
 * Original `Lti` (app-initial-fee819fe4f22.js @3221724) skips the dialog when
 * `!b || t !== "ultra" || s.reasoningEffort === "ultra"`. The panel slider can
 * only exercise two of those three arms, because it never emits the value that
 * is already selected, so the third is asserted here on the decision itself.
 */

const fullAccess = {
  sandbox: "danger-full-access" as const,
  permissionsKnown: true,
};

it("asks when ultra is newly combined with a known full access mode", () => {
  expect(
    needsUltraFullAccessConfirmation({
      nextEffort: "ultra",
      currentEffort: "high",
      ...fullAccess,
    }),
  ).toBe(true);
});

it("does not ask when the saved effort is already ultra", () => {
  // The official `s.reasoningEffort === "ultra"` arm: the combination is
  // already in effect, so re-selecting it introduces nothing to warn about.
  expect(
    needsUltraFullAccessConfirmation({
      nextEffort: "ultra",
      currentEffort: "ultra",
      ...fullAccess,
    }),
  ).toBe(false);
});

it("does not ask for any effort other than ultra, including under full access", () => {
  for (const nextEffort of [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ] as const) {
    expect
      .soft(
        needsUltraFullAccessConfirmation({
          nextEffort,
          currentEffort: "medium",
          ...fullAccess,
        }),
      )
      .toBe(false);
  }
});

it("does not ask under the restricted modes", () => {
  for (const sandbox of ["read-only", "workspace-write"] as const) {
    expect
      .soft(
        needsUltraFullAccessConfirmation({
          nextEffort: "ultra",
          currentEffort: "medium",
          sandbox,
          permissionsKnown: true,
        }),
      )
      .toBe(false);
  }
});

it("does not ask while the permission mode is still unconfirmed", () => {
  // An unconfirmed mode is not evidence of full access. The composer refuses
  // to render an unknown mode as a definite one, and this follows that rule
  // rather than guessing from a stale sandbox value.
  expect(
    needsUltraFullAccessConfirmation({
      nextEffort: "ultra",
      currentEffort: "medium",
      sandbox: "danger-full-access",
      permissionsKnown: false,
    }),
  ).toBe(false);
  expect(
    needsUltraFullAccessConfirmation({
      nextEffort: "ultra",
      currentEffort: "medium",
      sandbox: null,
      permissionsKnown: true,
    }),
  ).toBe(false);
});

it("does not invent a host restricted-mode preference", () => {
  expect(ULTRA_FALLBACK_SANDBOX).toBeNull();
});
