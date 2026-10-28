import { afterEach, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

/**
 * Per-field persistence only closes the multi-page gap if someone is listening.
 * Each store exports its own `start*Sync`, and the workbench is the single place
 * that mounts them; a store whose sync is written but never mounted still shows
 * a stale value until the user reloads the page.
 *
 * These assertions go through a real `storage` event rather than a mock call
 * count, so wiring the start function to the wrong store, or mounting it without
 * its listener, both fail here.
 */

import SessionWorkbenchEffects from "./SessionWorkbenchEffects";
import { useAgentSettingsStore } from "./stores/useAgentSettingsStore";
import { useConfigStore } from "./components/codex/stores/useConfigStore";

const AGENT_PREFIX = "kanban.session.agent-settings.v2.";
const CONFIG_PREFIX = "kanban.session.codex-config-storage.v3.";

/** What a second browser page on this machine does when a user chooses. */
function anotherPageSaves(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("adopts another page's Agent and instruction-scope choices while mounted", () => {
  const { unmount } = render(<SessionWorkbenchEffects />);
  try {
    act(() => {
      anotherPageSaves(`${AGENT_PREFIX}selectedAgent`, "cc");
      anotherPageSaves(`${AGENT_PREFIX}instructionType`, "project");
    });
    expect(useAgentSettingsStore.getState()).toMatchObject({
      selectedAgent: "cc",
      instructionType: "project",
    });
  } finally {
    unmount();
  }
});

it("adopts another page's new-chat permission default while mounted", () => {
  const { unmount } = render(<SessionWorkbenchEffects />);
  try {
    act(() => {
      anotherPageSaves(`${CONFIG_PREFIX}sandbox`, "read-only");
    });
    expect(useConfigStore.getState().sandbox).toBe("read-only");
  } finally {
    unmount();
  }
});

it("stops listening after unmount so a hidden page keeps no handlers", () => {
  // The store is a module singleton shared with the tests above, so the
  // baseline this one is about has to be set explicitly.
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  const { unmount } = render(<SessionWorkbenchEffects />);
  unmount();
  act(() => {
    anotherPageSaves(`${AGENT_PREFIX}selectedAgent`, "cc");
  });
  // The key is written, but an unmounted workbench must not apply it.
  expect(useAgentSettingsStore.getState().selectedAgent).toBe("codex");
});
