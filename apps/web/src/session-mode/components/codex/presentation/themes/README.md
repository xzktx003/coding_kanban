These two theme definitions are taken from the user-provided
`third_party/openai.chatgpt-26.51002.51308-linux-x64.vsix`, without changing its
245 TextMate rules or semantic token colors. The primary Codex diff viewer uses
them for saved/inline patches; Claude keeps its current renderer.

- Dark asset: `codex-dark-5fb95d1c65ca.js`, SHA256
  `2c7daf07edc321bfb076e53fc9390cc90f54632a2ce53fb57874f63e55cb79bd`.
- Light asset: `codex-light-53d4e35e1869.js`, SHA256
  `13c67c2ede5acc0bd035ba769fafb5030849e6a7affe49d75dcd78e87d2fca82`.

`code-theme-b9f8ff2360a8.js` registers these as the default CODEX choice.
The UI surface still follows the selected host/reference theme. The adapter
sets stable registration names `codex-light`/`codex-dark`, loads languages on
demand, joins live highlighting work and bounds its completed cache.

The primary native Markdown `CodeSurface` has a separate renderer:
`highlight-code-7c4c2ef3d4d8.js` uses highlight.js **11.11.1**, with semantic
`hljs-*` classes colored by `app-initial-983230c36f03.css` and the light/dark
syntax tokens in `app-initial-961644ef2fa7.css`. Our `nativeFenceHighlight`
uses that exact dependency version and `native-markdown.css` copies those
tokens. Its body is transparent over the actual host code surface (#20211d
for the approved dark host and #ffffff for light), rather than Shiki's
#111111/#ffffff editor theme backgrounds. Native Markdown geometry is
verified against the unmodified component in
`tests/e2e/session-codex-markdown-reference.spec.ts`.

Mermaid 的 scoped config 由 `nativeMermaidTheme.ts` 管理，来自相同 VSIX 原生 `image...V/be/je` 与 visualization theme 的实际宿主解析；SVG 使用原生 base 主题和两主题 node / text / arrow colors。`nativeMermaidLayout` 复用原生 `ye/B` pure wrapper，用 lazy layout-elk 0.2.2 兼容候选和既有 Mermaid 11.17.2 singleton（不升级）注册私有 layout；60px节点、开放marker、padding、edge labels 与测量字体flags已做实际原包对照。Streamdown 的既有 pan/zoom/复制/下载保留，不向 Claude 注入 plugin或覆盖其默认 renderer。原生 flowchart themeCSS 不套用到其他 diagram。完整证据与未覆盖的 diagram-family 边界见 `docs/designs/session-render-alignment/visual-acceptance.md`。
