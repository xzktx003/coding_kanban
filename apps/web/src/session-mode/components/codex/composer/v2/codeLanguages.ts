/** Plugin composer catalog (`wsr` in app-initial). Plain text has no English label. */
export const CODE_BLOCK_LANGUAGES: { label: string; value: string }[] = [
  { label: "Arduino", value: "arduino" },
  { label: "Bash", value: "bash" },
  { label: "C", value: "c" },
  { label: "C++", value: "cpp" },
  { label: "C#", value: "csharp" },
  { label: "CSS", value: "css" },
  { label: "Diff", value: "diff" },
  { label: "Go", value: "go" },
  { label: "GraphQL", value: "graphql" },
  { label: "INI", value: "ini" },
  { label: "Java", value: "java" },
  { label: "JavaScript", value: "javascript" },
  { label: "JSON", value: "json" },
  { label: "Kotlin", value: "kotlin" },
  { label: "LaTeX", value: "latex" },
  { label: "Less", value: "less" },
  { label: "Lua", value: "lua" },
  { label: "Makefile", value: "makefile" },
  { label: "Markdown", value: "markdown" },
  { label: "Mermaid", value: "mermaid" },
  { label: "Objective-C", value: "objectivec" },
  { label: "Perl", value: "perl" },
  { label: "PHP", value: "php" },
  { label: "PHP template", value: "php-template" },
  { label: "纯文本", value: "plaintext" },
  { label: "Python", value: "python" },
  { label: "Python REPL", value: "python-repl" },
  { label: "R", value: "r" },
  { label: "Ruby", value: "ruby" },
  { label: "Rust", value: "rust" },
  { label: "SCSS", value: "scss" },
  { label: "Shell", value: "shell" },
  { label: "SQL", value: "sql" },
  { label: "Swift", value: "swift" },
  { label: "TSRX", value: "tsrx" },
  { label: "TypeScript", value: "typescript" },
  { label: "Visual Basic .NET", value: "vbnet" },
  { label: "WebAssembly", value: "wasm" },
  { label: "XML", value: "xml" },
  { label: "YAML", value: "yaml" },
];

const aliases: Record<string, string> = {
  "c#": "csharp",
  "c++": "cpp",
  cs: "csharp",
  gql: "graphql",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  objc: "objectivec",
  patch: "diff",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  tex: "latex",
  text: "plaintext",
  ts: "typescript",
  tsx: "typescript",
  vb: "vbnet",
  yml: "yaml",
  zsh: "bash",
};

export function canonicalCodeLanguage(language: string) {
  const key = language.trim().toLowerCase();
  if (!key) return "";
  return aliases[key] ?? CODE_BLOCK_LANGUAGES.find((item) => item.value === key)?.value ?? key;
}

export function codeLanguageLabel(language: string) {
  const value = canonicalCodeLanguage(language);
  return CODE_BLOCK_LANGUAGES.find((item) => item.value === value)?.label ?? language;
}

const detectors: { language: string; pattern: RegExp }[] = [
  { language: "diff", pattern: /^(?:diff\s|---\s.+\n\+\+\+\s)|^@@\s/m },
  { language: "sql", pattern: /^(?:SELECT\b.+\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\S+\s+SET\b|CREATE\s+(?:TABLE|INDEX)\b)/im },
  { language: "python", pattern: /^(?:def |class |import |from \S+ import )/m },
  { language: "rust", pattern: /^(?:fn |use |pub |let mut )/m },
  { language: "go", pattern: /^package \w+/m },
  { language: "javascript", pattern: /^(?:function |const |let |export )/m },
];

/** Plugin `ysr`: empty stays unset, JSON/XML first, then a short pattern list. */
export function detectCodeLanguage(source: string): string | null {
  const text = source.trim();
  if (!text) return null;
  if (
    (text.startsWith("{") || text.startsWith("[") || text.startsWith("//") || text.startsWith("/*")) &&
    looksLikeJson(text)
  )
    return "json";
  if (text.startsWith("<?xml") || /<\/[A-Za-z][^>]*>/.test(text)) return "xml";
  return detectors.find((item) => item.pattern.test(text))?.language ?? null;
}

function looksLikeJson(text: string) {
  const body = text.replace(/^\s*\/\*[\s\S]*?\*\//, "").replace(/^\s*\/\/.*$/m, "").trim();
  if (!body.startsWith("{") && !body.startsWith("[")) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}
