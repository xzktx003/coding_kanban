import MarkdownIt from "markdown-it";
import {
  parseNativeFileCitations,
  type NativeFileCitation,
} from "./nativeFileCitations";
import { nativeCitationFileKind } from "./NativeCitationFileIcon";

const codeKinds = new Set([
  "code",
  "cplusplus",
  "html",
  "java",
  "javascript",
  "json",
  "notebook",
  "php",
  "python",
  "react",
  "rust",
  "typescript",
  "css",
  "toml",
  "shell",
]);
/** Native wfi/Tfi/Afi: clipboard uses the accessible label, not directive syntax. */
export function nativeCitationLabels(
  citation: NativeFileCitation,
  language = "en",
) {
  const name = citation.path.split(/[\\/]/).at(-1) || citation.path;
  const zh = language.startsWith("zh");
  const start = citation.lineStart,
    end = citation.lineEnd;
  const location =
    start == null ||
    (start === 1 &&
      !codeKinds.has(nativeCitationFileKind(citation.path)) &&
      (end == null || end === start))
      ? ""
      : end != null && end !== start
        ? zh
          ? `第 ${start}-${end} 行`
          : `lines ${start}-${end}`
        : zh
          ? `第 ${start} 行`
          : `line ${start}`;
  return {
    displayLabel: location ? `${name} (${location})` : name,
    ariaLabel: location
      ? `${name} ${zh ? `（${location}）` : `(${location})`}`
      : name,
  };
}

/** Parse in the Markdown grammar so code, HTML, link destinations and image
 * descriptions cannot acquire attribution cleanup merely by matching a regex.
 * Mapping uses actual source lines; unresolvable offsets retain literal text.
 */
export function cleanNativeFileCitationSource(
  source: string,
  language = "en",
): string {
  const markdown = new MarkdownIt({ html: true });
  markdown.inline.ruler.before(
    "text",
    "native-citation-copy",
    (state, silent) => {
      if ((state as typeof state & { linkLevel?: number }).linkLevel)
        return false;
      const candidate = parseNativeFileCitations(state.src.slice(state.pos))[0];
      if (!candidate) return false;
      if (candidate.sourceStart) {
        const prefix = state.src.slice(
          state.pos,
          state.pos + candidate.sourceStart,
        );
        if (/[\n!#$%&*+\-:<=>@[\\\]^_`{}~]/.test(prefix)) return false;
        if (!silent) state.pending += prefix;
        state.pos += prefix.length;
        return true;
      }
      if (!silent) {
        const token = state.push("nativeCitationCopy", "", 0);
        token.meta = { offset: state.pos, match: candidate };
      }
      state.pos += candidate.sourceEnd;
      return true;
    },
  );
  const lines = source.split("\n"),
    offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const block of markdown.parse(source, {})) {
    if (block.type !== "inline" || !block.map) continue;
    for (const token of block.children ?? []) {
      if (token.type !== "nativeCitationCopy") continue;
      const { offset, match } = token.meta as {
        offset: number;
        match: ReturnType<typeof parseNativeFileCitations>[number];
      };
      const prefix = block.content.slice(0, offset),
        row = prefix.split("\n").length - 1;
      const column = prefix.length - (prefix.lastIndexOf("\n") + 1);
      const lineIndex = block.map[0] + row;
      const inlineLine = block.content.split("\n")[row];
      const indent = lines[lineIndex]?.indexOf(inlineLine) ?? -1;
      if (indent < 0) continue;
      const start = offsets[lineIndex] + indent + column;
      const end = start + match.matchedText.length;
      if (source.slice(start, end) !== match.matchedText) continue;
      replacements.push({
        start,
        end,
        text: nativeCitationLabels(match.citation, language).ariaLabel,
      });
    }
  }
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    source =
      source.slice(0, replacement.start) +
      replacement.text +
      source.slice(replacement.end);
  return source;
}
