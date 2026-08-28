import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  focusActiveTerminalTextarea,
  hasIntentionalExternalFocus,
  shouldActivateTerminalPaneFromPointer,
  shouldPromoteExternalFocusToUserIntent,
  shouldRepairPassiveTerminalFocus,
} from "./terminal-focus.js";

describe("focusActiveTerminalTextarea", () => {
  it("does not collapse a document text selection during passive focus recovery", () => {
    const documentDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    const windowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    let focusCalls = 0;

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector: () => ({
          focus: () => {
            focusCalls += 1;
          },
        }),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getSelection: () => ({ isCollapsed: false, rangeCount: 1 }),
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          callback(0);
          return 1;
        },
        setTimeout: (callback: TimerHandler) => {
          if (typeof callback === "function") callback();
          return 1;
        },
      },
    });

    try {
      focusActiveTerminalTextarea();
      assert.equal(focusCalls, 0);
    } finally {
      if (documentDescriptor) {
        Object.defineProperty(globalThis, "document", documentDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});

describe("shouldRepairPassiveTerminalFocus", () => {
  it("repairs focus when the terminal was the user's most recent focus target", () => {
    assert.equal(
      shouldRepairPassiveTerminalFocus({
        documentHasFocus: true,
        helperAvailable: true,
        helperFocused: false,
        intentionalExternalFocus: false,
        lastExternalUserIntentAt: 10,
        lastTerminalIntentAt: 20,
      }),
      true,
    );
  });

  it("does not repair focus while an intentional external target still owns it", () => {
    assert.equal(
      shouldRepairPassiveTerminalFocus({
        documentHasFocus: true,
        helperAvailable: true,
        helperFocused: false,
        intentionalExternalFocus: true,
        lastExternalUserIntentAt: 20,
        lastTerminalIntentAt: 30,
      }),
      false,
    );
  });

  it("does not repair focus when the editor was the most recent intentional target", () => {
    assert.equal(
      shouldRepairPassiveTerminalFocus({
        documentHasFocus: true,
        helperAvailable: true,
        helperFocused: false,
        intentionalExternalFocus: false,
        lastExternalUserIntentAt: 30,
        lastTerminalIntentAt: 20,
      }),
      false,
    );
  });

  it("does not repair focus when the terminal helper is already focused", () => {
    assert.equal(
      shouldRepairPassiveTerminalFocus({
        documentHasFocus: true,
        helperAvailable: true,
        helperFocused: true,
        intentionalExternalFocus: false,
        lastExternalUserIntentAt: 0,
        lastTerminalIntentAt: 20,
      }),
      false,
    );
  });

  it("repairs focus when no external target has claimed ownership yet", () => {
    assert.equal(
      shouldRepairPassiveTerminalFocus({
        documentHasFocus: true,
        helperAvailable: true,
        helperFocused: false,
        intentionalExternalFocus: false,
        lastExternalUserIntentAt: 0,
        lastTerminalIntentAt: 0,
      }),
      true,
    );
  });
});

describe("shouldActivateTerminalPaneFromPointer", () => {
  it("keeps right-click from selecting a terminal monitor pane", () => {
    assert.equal(
      shouldActivateTerminalPaneFromPointer({
        button: 2,
        pointerType: "mouse",
      }),
      false,
    );
  });

  it("allows left-click and touch to select a terminal monitor pane", () => {
    assert.equal(
      shouldActivateTerminalPaneFromPointer({
        button: 0,
        pointerType: "mouse",
      }),
      true,
    );
    assert.equal(
      shouldActivateTerminalPaneFromPointer({
        button: 0,
        pointerType: "touch",
      }),
      true,
    );
  });

  it("treats xterm's helper textarea as pane content instead of an external editor", () => {
    assert.equal(
      shouldActivateTerminalPaneFromPointer({
        button: 0,
        pointerType: "mouse",
        targetIsInteractiveControl: true,
        targetIsTerminalHelperTextarea: true,
      }),
      true,
    );
    assert.equal(
      shouldActivateTerminalPaneFromPointer({
        button: 0,
        pointerType: "mouse",
        targetIsInteractiveControl: true,
        targetIsTerminalHelperTextarea: false,
      }),
      false,
    );
  });
});

describe("hasIntentionalExternalFocus", () => {
  it("does not let passive protected focus override a newer terminal click", () => {
    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: false,
        activeElementProtected: true,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 100,
        lastTerminalIntentAt: 200,
        now: 300,
      }),
      false,
    );
  });

  it("keeps a real external editor click protected after the terminal was focused", () => {
    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: false,
        activeElementProtected: true,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 300,
        lastTerminalIntentAt: 200,
        now: 350,
      }),
      true,
    );
  });

  it("protects the body handoff grace only for the current external owner", () => {
    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: true,
        activeElementProtected: false,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 300,
        lastTerminalIntentAt: 200,
        now: 500,
      }),
      true,
    );

    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: true,
        activeElementProtected: false,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 300,
        lastTerminalIntentAt: 400,
        now: 500,
      }),
      false,
    );
  });
});

describe("shouldPromoteExternalFocusToUserIntent", () => {
  it("does not promote a passive external focus after the user clicks the terminal", () => {
    assert.equal(
      shouldPromoteExternalFocusToUserIntent({
        externalFocusGraceMs: 750,
        hasFreshUserActivation: false,
        lastExternalPointerIntentAt: 0,
        lastExternalUserIntentAt: 0,
        lastTerminalIntentAt: 200,
        now: 500,
        targetIsFrame: false,
        targetIsHovered: false,
      }),
      false,
    );
  });

  it("promotes external focus when it follows an external pointer intent", () => {
    assert.equal(
      shouldPromoteExternalFocusToUserIntent({
        externalFocusGraceMs: 750,
        hasFreshUserActivation: false,
        lastExternalPointerIntentAt: 450,
        lastExternalUserIntentAt: 0,
        lastTerminalIntentAt: 200,
        now: 500,
        targetIsFrame: false,
        targetIsHovered: false,
      }),
      true,
    );
  });

  it("does not promote focus from terminal click activation alone", () => {
    assert.equal(
      shouldPromoteExternalFocusToUserIntent({
        externalFocusGraceMs: 750,
        hasFreshUserActivation: true,
        lastExternalPointerIntentAt: 0,
        lastExternalUserIntentAt: 0,
        lastTerminalIntentAt: 200,
        now: 500,
        targetIsFrame: false,
        targetIsHovered: false,
      }),
      false,
    );
  });

  it("promotes iframe focus when user activation lands on the iframe", () => {
    assert.equal(
      shouldPromoteExternalFocusToUserIntent({
        externalFocusGraceMs: 750,
        hasFreshUserActivation: true,
        lastExternalPointerIntentAt: 0,
        lastExternalUserIntentAt: 0,
        lastTerminalIntentAt: 200,
        now: 500,
        targetIsFrame: false,
        targetIsHovered: true,
      }),
      true,
    );
  });

  it("does not reuse an older external pointer after the user clicks the terminal", () => {
    assert.equal(
      shouldPromoteExternalFocusToUserIntent({
        externalFocusGraceMs: 750,
        hasFreshUserActivation: false,
        lastExternalPointerIntentAt: 150,
        lastExternalUserIntentAt: 100,
        lastTerminalIntentAt: 200,
        now: 500,
        targetIsFrame: false,
        targetIsHovered: false,
      }),
      false,
    );
  });

  it("promotes hovered iframe focus even without parent document pointerdown", () => {
    assert.equal(
      shouldPromoteExternalFocusToUserIntent({
        externalFocusGraceMs: 750,
        hasFreshUserActivation: false,
        lastExternalPointerIntentAt: 0,
        lastExternalUserIntentAt: 100,
        lastTerminalIntentAt: 200,
        now: 500,
        targetIsFrame: true,
        targetIsHovered: true,
      }),
      true,
    );
  });

  it("does not promote passive iframe focus when the pointer is not over it", () => {
    assert.equal(
      shouldPromoteExternalFocusToUserIntent({
        externalFocusGraceMs: 750,
        hasFreshUserActivation: false,
        lastExternalPointerIntentAt: 0,
        lastExternalUserIntentAt: 100,
        lastTerminalIntentAt: 200,
        now: 500,
        targetIsFrame: true,
        targetIsHovered: false,
      }),
      false,
    );
  });
});

describe("hasIntentionalExternalFocus — non-protected target regression", () => {
  it("does not treat a focused button as intentional text-entry focus", () => {
    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: false,
        activeElementProtected: false,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 300,
        lastTerminalIntentAt: 200,
        now: 350,
      }),
      false,
    );
  });

  it("keeps a brief body handoff protected while an external owner settles", () => {
    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: true,
        activeElementProtected: false,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 300,
        lastTerminalIntentAt: 200,
        now: 350,
      }),
      true,
    );
  });

  it("lets the terminal reclaim focus after the body handoff grace expires", () => {
    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: true,
        activeElementProtected: false,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 300,
        lastTerminalIntentAt: 200,
        now: 1200,
      }),
      false,
    );
  });

  it("does not claim intentional external focus when terminal was clicked last", () => {
    assert.equal(
      hasIntentionalExternalFocus({
        activeElementIsDocumentBody: false,
        activeElementProtected: false,
        externalFocusGraceMs: 750,
        lastExternalUserIntentAt: 200,
        lastTerminalIntentAt: 300,
        now: 350,
      }),
      false,
    );
  });
});
