import {
  bundledLanguages,
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
  type ThemeRegistration,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { CodeHighlighterPlugin, HighlightResult } from "@streamdown/code";
import lightTheme from "./themes/codex-light.json";
import darkTheme from "./themes/codex-dark.json";

// Original VSIX Shiki code themes for diff/patch renderers. The primary native
// Markdown fence uses highlight.js and its own syntax tokens instead.
const themes: [string, string] = ["codex-light", "codex-dark"];
const aliases = new Map(
  bundledLanguagesInfo.flatMap((language) =>
    (language.aliases ?? []).map((alias) => [alias, language.id] as const),
  ),
);
const canonical = (language: string) =>
  aliases.get(language.trim().toLowerCase()) ?? language.trim().toLowerCase();
const supported = new Set(Object.keys(bundledLanguages));
let highlighter: Promise<Highlighter> | undefined;
const languageLoads = new Map<string, Promise<Highlighter>>();
const cache = new Map<string, HighlightResult>();
const pending = new Map<string, Promise<HighlightResult>>();
let cacheChars = 0;
function loadLanguage(language: string) {
  let loading = languageLoads.get(language);
  if (loading) return loading;
  highlighter ??= createHighlighter({
    themes: [
      { ...lightTheme, name: themes[0] } as ThemeRegistration,
      { ...darkTheme, name: themes[1] } as ThemeRegistration,
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  loading = highlighter.then(async (instance) => {
    if (
      supported.has(language) &&
      !instance.getLoadedLanguages().includes(language)
    )
      await instance.loadLanguage(language as BundledLanguage);
    return instance;
  });
  languageLoads.set(language, loading);
  void loading.catch(() => languageLoads.delete(language));
  return loading;
}
function remember(key: string, result: HighlightResult) {
  cache.set(key, result);
  cacheChars += key.length;
  while (cache.size > 128 || cacheChars > 1_000_000) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cacheChars -= oldest.length;
    cache.delete(oldest);
  }
}
export const codexCode: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  supportsLanguage: (language) => supported.has(canonical(language)),
  getSupportedLanguages: () => [...supported] as BundledLanguage[],
  // Streamdown 2.2's interface types only bundled names; Shiki also accepts loaded custom themes.
  getThemes: () => [...themes] as [BundledTheme, BundledTheme],
  highlight({ code, language }, callback) {
    const lang = canonical(language);
    const key = JSON.stringify([lang, code]);
    const cached = cache.get(key);
    if (cached) return cached;
    let loading = pending.get(key);
    if (!loading) {
      loading = loadLanguage(lang)
        .then((instance) => {
          const tokens = instance.codeToTokens(code, {
            lang: supported.has(lang) ? (lang as BundledLanguage) : "text",
            themes: { light: themes[0], dark: themes[1] },
          });
          // Shiki's multi-theme bg/fg strings contain semicolon-separated CSS
          // declarations for its HTML writer. Streamdown assigns them to React
          // custom properties, so those strings are invalid color values there.
          const light = instance.getTheme(themes[0]);
          const dark = instance.getTheme(themes[1]);
          const result: HighlightResult = {
            ...tokens,
            bg: light.bg,
            fg: light.fg,
            rootStyle: `--shiki-dark-bg:${dark.bg};--shiki-dark:${dark.fg}`,
          };
          pending.delete(key);
          remember(key, result);
          return result;
        })
        .catch((error) => {
          pending.delete(key);
          throw error;
        });
      pending.set(key, loading);
    }
    void loading.then(
      (result) => callback?.(result),
      (error) => {
        console.error("Codex code highlighting failed:", error);
      },
    );
    return null;
  },
};
