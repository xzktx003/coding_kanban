import { normalizeUnifiedDiff, type UnifiedFileDiff } from "@session/utils/diff";
/** Git uses C quoting and octal UTF-8 bytes, not JSON or URL escaping. */
export function nativeGitPatchPath(value: string): string | null {
  if (!value.startsWith('"')) return value.split("\t", 1)[0];
  const bytes: number[] = [], encoder = new TextEncoder();
  for (let index = 1; index < value.length; index++) {
    const char = value[index];
    if (char === '"') {
      if (value.slice(index + 1).trim() && !value.slice(index + 1).startsWith("\t")) return null;
      try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); } catch { return null; }
    }
    if (char === "\\") {
      const octal = value.slice(index + 1).match(/^[0-7]{1,3}/);
      if (octal) { bytes.push(Number.parseInt(octal[0], 8)); index += octal[0].length; continue; }
      const escaped = value[++index], escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07", '"': '"', "\\": "\\" };
      if (!(escaped in escapes)) return null;
      bytes.push(...encoder.encode(escapes[escaped]));
    } else {
      const codepoint = value.codePointAt(index)!;
      bytes.push(...encoder.encode(String.fromCodePoint(codepoint)));
      if (codepoint > 0xffff) index++;
    }
  }
  return null;
}
function path(lines: string[]) {
  for (const prefix of ["+++ ", "--- "]) {
    const header = lines.find(line => line.startsWith(prefix));
    if (!header) continue;
    const value = nativeGitPatchPath(header.slice(prefix.length));
    if (value && value !== "/dev/null") return value.replace(/^[ab]\//, "");
  }
  for (const prefix of ["rename to ", "rename from "]) {
    const header = lines.find(line => line.startsWith(prefix));
    const value = header && nativeGitPatchPath(header.slice(prefix.length));
    if (value) return value;
  }
  const header = lines.find(line => line.startsWith("diff --git "))?.slice(11);
  if (!header) return "";
  const quoted = header.match(/^("(?:\\.|[^"\\])*"|a\/\S+) ("(?:\\.|[^"\\])*"|b\/\S+)$/);
  if (quoted) return (nativeGitPatchPath(quoted[2]) ?? "").replace(/^b\//, "");
  // Git leaves spaces unquoted for a mode-only path. Accept only an exact
  // same-path pair; ambiguous names are never turned into another file target.
  for (const match of header.matchAll(/ b\//g)) {
    const left = header.slice(0, match.index).replace(/^a\//, ""), right = header.slice(match.index + 3);
    if (left === right) return right;
  }
  return "";
}
export function splitNativePatchFiles(value?: string): UnifiedFileDiff[] {
  const normalized = normalizeUnifiedDiff(value);
  if (!normalized.trim()) return [];
  return normalized.split(/(?=^diff --git )/m).filter(Boolean).map(diff => ({ path: path(diff.split("\n")), diff }));
}
