// The primary Markdown CodeSurface in openai.chatgpt 26.51002.51308 uses
// highlight.js 11.11.1, not the Shiki themes used by the native diff viewer.
const nativeLanguages = [
  "arduino",
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "dos",
  "go",
  "graphql",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "less",
  "lua",
  "makefile",
  "markdown",
  "objectivec",
  "perl",
  "php",
  "php-template",
  "plaintext",
  "powershell",
  "python",
  "python-repl",
  "r",
  "ruby",
  "rust",
  "scss",
  "shell",
  "sql",
  "swift",
  "tsrx",
  "typescript",
  "vbnet",
  "wasm",
  "xml",
  "yaml",
  "clojure",
  "dart",
  "haskell",
  "latex",
  "lisp",
  "mathematica",
  "matlab",
  "nginx",
  "ocaml",
  "pgsql",
  "scala",
  "verilog",
];
const aliases: Record<string, string> = {
  threejs: "javascript",
  commonlisp: "lisp",
  wolfram: "mathematica",
  recharts: "typescript",
  vue: "xml",
};
let highlighter:
  | Promise<(typeof import("highlight.js"))["default"]>
  | undefined;
const cache = new Map<string, string>();
let cacheChars = 0;
export const nativeFenceHighlight = {
  highlight(
    { code, language }: { code: string; language: string },
    callback: (html: string) => void,
  ): string | null {
    const key = JSON.stringify([language, code]);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    highlighter ??= Promise.all([
      import("highlight.js"),
      import("./nativeTsrx.js"),
    ]).then(([module, tsrx]) => {
      const instance = module.default.newInstance();
      // Match the original registry: unsupported fences remain plaintext and
      // auto-detection is not influenced by extra grammars in the full package.
      for (const language of nativeLanguages)
        if (language !== "tsrx")
          instance.registerLanguage(
            language,
            () => module.default.getLanguage(language)!,
          );
      instance.registerLanguage("tsrx", tsrx.default);
      for (const [alias, languageName] of Object.entries(aliases))
        instance.registerAliases(alias, { languageName });
      return instance;
    });
    void highlighter.then(
      (instance) => {
        const requested = language.trim().toLowerCase();
        const languageId = aliases[requested] ?? requested;
        const result = languageId
          ? instance.highlight(code, {
              language: instance.getLanguage(languageId)
                ? languageId
                : "plaintext",
            })
          : instance.highlightAuto(code, nativeLanguages);
        cache.set(key, result.value);
        cacheChars += key.length + result.value.length;
        while (cache.size > 128 || cacheChars > 1_000_000) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cacheChars -= oldest.length + cache.get(oldest)!.length;
          cache.delete(oldest);
        }
        callback(result.value);
      },
      () =>
        callback(
          code
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;"),
        ),
    );
    return null;
  },
};
