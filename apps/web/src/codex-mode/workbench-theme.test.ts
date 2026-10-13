import { expect, it } from "vitest";
import { applyWorkbenchTheme, nativeCodexTheme } from "./workbench-theme";

it("applies one resolved theme to both mounted workbench modes", () => {
  document.body.innerHTML =
    '<div class="session-mode dark"></div><div class="codex-mode light"></div>';
  applyWorkbenchTheme(document, "light");
  const session = document.querySelector(".session-mode")!;
  const codex = document.querySelector(".codex-mode")!;
  expect(session.classList.contains("light")).toBe(true);
  expect(session.classList.contains("dark")).toBe(false);
  expect(codex.classList.contains("light")).toBe(true);
  expect(codex.classList.contains("dark")).toBe(false);
  expect((session as HTMLElement).style.colorScheme).toBe("light");
  expect((codex as HTMLElement).style.colorScheme).toBe("light");
  applyWorkbenchTheme(document, "dark");
  expect(session.classList.contains("dark")).toBe(true);
  expect(codex.classList.contains("dark")).toBe(true);
});

it("maps only light and dark onto the native editor themes", () => {
  expect(nativeCodexTheme("dark")).toEqual({
    theme: "dark",
    colorTheme: "Default Dark Modern",
  });
  expect(nativeCodexTheme("light")).toEqual({
    theme: "light",
    colorTheme: "Default Light Modern",
  });
  expect(() => nativeCodexTheme("system" as "dark")).toThrow(/light or dark/);
});
