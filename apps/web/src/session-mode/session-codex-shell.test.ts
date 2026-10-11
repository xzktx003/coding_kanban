import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const theme = readFileSync(resolve(directory, "session-theme.css"), "utf8");
const navigation = readFileSync(
  resolve(directory, "session-navigation.css"),
  "utf8",
);
const selection = readFileSync(
  resolve(directory, "session-selection.css"),
  "utf8",
);

function block(source: string, selector: string) {
  const start = source.indexOf(selector);
  const next = source.indexOf("\n}", start);
  return source.slice(start, next);
}

it("paints the default session shell with the Codex editor palette", () => {
  const dark = block(theme, ".session-mode.dark.accent-default");
  const light = block(theme, ".session-mode.light.accent-default");

  expect(dark).toContain("--background: #20211d");
  expect(dark).toContain("--sidebar: #282a23");
  expect(dark).toContain("--foreground: #cccccc");
  expect(dark).toContain("--primary: #63a8f8");
  expect(dark).not.toContain("#151b21");
  expect(dark).not.toContain("#dcc49a");

  expect(light).toContain("--background: #ffffff");
  expect(light).toContain("--sidebar: #f5f5f3");
  expect(light).toContain("--foreground: #3b3b3b");
  expect(light).toContain("--primary: #1c64c8");

  expect(navigation).not.toContain("#20252c");
  expect(navigation).not.toContain("#191e24");
  expect(selection).toContain("--session-selection-underline: #63a8f8");
  expect(selection).not.toContain("#d6b77a");
  expect(selection).not.toContain("#94713d");
});
