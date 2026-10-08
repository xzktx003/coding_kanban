import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ThemeProvider, useThemeContext } from "./ThemeContext";
import { useThemeStore } from "../stores/settings/useThemeStore";
let root: HTMLElement;
afterEach(() => root?.remove());
it("applies both themes to the session scope without changing the document or remounting children", async () => {
  root = document.createElement("div");
  root.className = "session-mode dark";
  document.body.append(root);
  const original = document.documentElement.className;
  useThemeStore.setState({ theme: "light", accent: "default" });
  function Child() {
    const t = useThemeContext();
    return <input aria-label={t.resolvedTheme} defaultValue="保留草稿" />;
  }
  render(
    <ThemeProvider>
      <ThemeProvider>
        <Child />
      </ThemeProvider>
    </ThemeProvider>,
    { container: root },
  );
  const input = screen.getByRole("textbox");
  await waitFor(() => expect(root.classList.contains("light")).toBe(true));
  act(() => useThemeStore.getState().toggleTheme());
  await waitFor(() => expect(root.classList.contains("dark")).toBe(true));
  expect(screen.getByRole("textbox")).toBe(input);
  expect((input as HTMLInputElement).value).toBe("保留草稿");
  expect(document.documentElement.className).toBe(original);
  expect(root.style.colorScheme).toBe("dark");
});
