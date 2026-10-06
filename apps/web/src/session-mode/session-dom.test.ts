import { afterEach, describe, expect, it, vi } from "vitest";
import { isSessionModeActive, listenInSessionMode } from "./session-dom";

afterEach(() => { document.querySelectorAll(".session-mode").forEach(node => node.remove()); });
describe("mode keyboard ownership", () => {
  it("hidden session mode never handles terminal shortcuts", () => {
    const root = document.createElement("div"); root.className = "session-mode"; root.hidden = true; document.body.append(root);
    const listener = vi.fn(); const cleanup = listenInSessionMode(window, "keydown", listener);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true }));
    expect(listener).not.toHaveBeenCalled(); expect(isSessionModeActive()).toBe(false);
    root.hidden = false;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true }));
    expect(listener).toHaveBeenCalledTimes(1); expect(isSessionModeActive()).toBe(true);
    cleanup(); window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
