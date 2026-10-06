// Scope the migrated design system, including Tailwind preflight, to its mode.
export function scopeSessionSelector(selector) {
  if (selector.includes(".session-mode")) return selector;
  const root = selector.replace(
    /^(?::root|html|body|#root)(?=[\s.:#\[]|$)/,
    ".session-mode",
  );
  if (root !== selector) return root;
  if (/^\.(?:dark|light|accent-[\w-]+)(?=[\s.:#\[]|$)/.test(selector))
    return `.session-mode${selector}`;
  return `.session-mode ${selector}`;
}

export function sessionCssScope() {
  return {
    postcssPlugin: "session-css-scope",
    Once(root) {
      const file = root.source?.input?.file?.replace(/\\/g, "/") ?? "";
      if (!file.includes("/src/session-mode/")) return;
      root.walkRules((rule) => {
        let parent = rule.parent;
        while (parent) {
          if (parent.type === "atrule" && /keyframes$/i.test(parent.name))
            return;
          parent = parent.parent;
        }
        if (rule.selector?.startsWith("&")) return;
        rule.selectors = rule.selectors.map(scopeSessionSelector);
      });
    },
  };
}
