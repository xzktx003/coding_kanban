interface PassiveTerminalFocusRepairOptions {
  documentHasFocus: boolean;
  helperAvailable: boolean;
  helperFocused: boolean;
  intentionalExternalFocus: boolean;
  lastExternalUserIntentAt: number;
  lastTerminalIntentAt: number;
}

interface IntentionalExternalFocusOptions {
  activeElementIsDocumentBody: boolean;
  activeElementProtected: boolean;
  externalFocusGraceMs: number;
  lastExternalUserIntentAt: number;
  lastTerminalIntentAt: number;
  now: number;
}

interface ExternalFocusPromotionOptions {
  externalFocusGraceMs: number;
  hasFreshUserActivation: boolean;
  lastExternalPointerIntentAt: number;
  lastExternalUserIntentAt: number;
  lastTerminalIntentAt: number;
  now: number;
  targetIsFrame: boolean;
  targetIsHovered: boolean;
}

interface TerminalPanePointerActivationOptions {
  button: number;
  pointerType: string;
  targetIsInteractiveControl?: boolean;
  targetIsTerminalHelperTextarea?: boolean;
}

export function getActiveTerminalTextarea(): HTMLTextAreaElement | null {
  return document.querySelector(
    '[data-active-terminal-pane="true"] .xterm-helper-textarea',
  ) as HTMLTextAreaElement | null;
}

export function focusActiveTerminalTextarea(): void {
  const focusUnlessSelectingText = () => {
    // This helper is used by passive layout/focus recovery. Focusing xterm's
    // hidden textarea while the user is selecting a preview collapses the
    // browser selection, so every deferred retry must re-check ownership.
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      return;
    }

    getActiveTerminalTextarea()?.focus();
  };

  focusUnlessSelectingText();
  window.requestAnimationFrame(focusUnlessSelectingText);
  window.setTimeout(focusUnlessSelectingText, 0);
}

export function shouldActivateTerminalPaneFromPointer(
  options: TerminalPanePointerActivationOptions,
): boolean {
  if (options.pointerType === "mouse" && options.button !== 0) {
    return false;
  }

  return (
    !options.targetIsInteractiveControl ||
    Boolean(options.targetIsTerminalHelperTextarea)
  );
}

export function hasIntentionalExternalFocus(
  options: IntentionalExternalFocusOptions,
): boolean {
  if (
    options.lastExternalUserIntentAt === 0 ||
    options.lastExternalUserIntentAt < options.lastTerminalIntentAt
  ) {
    return false;
  }

  if (options.activeElementProtected) {
    return true;
  }

  return (
    options.activeElementIsDocumentBody &&
    options.now - options.lastExternalUserIntentAt <
      options.externalFocusGraceMs
  );
}

export function shouldPromoteExternalFocusToUserIntent(
  options: ExternalFocusPromotionOptions,
): boolean {
  if (options.lastTerminalIntentAt === 0) {
    return true;
  }

  if (
    options.lastExternalUserIntentAt > 0 &&
    options.lastExternalUserIntentAt >= options.lastTerminalIntentAt
  ) {
    return true;
  }

  if (options.hasFreshUserActivation && options.targetIsHovered) {
    return true;
  }

  if (options.targetIsFrame && options.targetIsHovered) {
    return true;
  }

  return (
    options.lastExternalPointerIntentAt > 0 &&
    options.lastExternalPointerIntentAt > options.lastTerminalIntentAt &&
    options.now - options.lastExternalPointerIntentAt <
      options.externalFocusGraceMs
  );
}

export function shouldRepairPassiveTerminalFocus(
  options: PassiveTerminalFocusRepairOptions,
): boolean {
  if (!options.documentHasFocus) {
    return false;
  }

  if (!options.helperAvailable || options.helperFocused) {
    return false;
  }

  if (options.intentionalExternalFocus) {
    return false;
  }

  if (options.lastExternalUserIntentAt === 0) {
    return true;
  }

  return options.lastTerminalIntentAt > options.lastExternalUserIntentAt;
}
