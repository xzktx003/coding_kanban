import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { icons } from "lucide-react";

// Loaded with the preview, so the icon catalogue does not slow ordinary messages.
export function visualizationIcons(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of content.matchAll(/data-lucide=["']([a-z0-9-]+)["']/g)) {
    const name = match[1];
    const key = name
      .split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join("");
    const Icon = icons[key as keyof typeof icons];
    if (Icon && !result[name])
      result[name] = renderToStaticMarkup(createElement(Icon, { size: 18 }));
  }
  return result;
}
