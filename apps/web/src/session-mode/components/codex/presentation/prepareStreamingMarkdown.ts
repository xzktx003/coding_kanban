/**
 * Present the unfinished end of a live message like the native renderer:
 * keep completed content, but wait for a link's closing syntax before
 * showing it. This only receives the already bounded changing tail.
 */
export function prepareStreamingMarkdown(source: string): string {
  let fence: { marker: string; length: number } | undefined;
  let inline = 0;
  let offset = 0;
  let lastLine = 0;
  while (offset < source.length) {
    const end = source.indexOf("\n", offset);
    if (end < 0) break;
    const line = source.slice(offset, end);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const chars = marker[1];
      if (!fence && !(chars[0] === "`" && marker[2].includes("`")))
        fence = { marker: chars[0], length: chars.length };
      else if (
        fence &&
        chars[0] === fence.marker &&
        chars.length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
    } else if (!fence) {
      for (let i = offset; i < end; i++) {
        if (source[i] === "\\") {
          i++;
          continue;
        }
        if (source[i] !== "`") continue;
        let length = 1;
        while (i + length < end && source[i + length] === "`") length++;
        if (inline === length) inline = 0;
        else if (!inline) inline = length;
        i += length - 1;
      }
    }
    lastLine = end + 1;
    offset = end + 1;
  }
  const finalLine = source.slice(lastLine);
  if (fence || /^(?: {4}|\t| {0,3}(?:`{3,}|~{3,}))/.test(finalLine))
    return source;
  // The official renderer defers incomplete images on a line of their own.
  if (/^\s*!\[[^\]\n]*(?:\](?:\([^)\n]*)?)?\s*$/.test(finalLine))
    return source.slice(0, lastLine);
  const balancedEnd = (start: number, opening: string, closing: string) => {
    let depth = 0;
    let code = 0;
    let quote = "";
    for (let i = start; i < source.length; i++) {
      if (source[i] === "\\") {
        i++;
        continue;
      }
      if (opening === "[" && source[i] === "`") {
        let length = 1;
        while (source[i + length] === "`") length++;
        if (code === length) code = 0;
        else if (!code) code = length;
        i += length - 1;
        continue;
      }
      if (code) continue;
      if (quote) {
        if (source[i] === quote) quote = "";
        continue;
      }
      if (
        opening === "(" &&
        (i === start + 1 || /\s/.test(source[i - 1])) &&
        (source[i] === "<" || source[i] === '"' || source[i] === "'")
      ) {
        quote = source[i] === "<" ? ">" : source[i];
        continue;
      }
      if (source[i] === opening) depth++;
      else if (source[i] === closing && --depth === 0) return i;
    }
    return -1;
  };
  for (let i = lastLine; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === "`") {
      let length = 1;
      while (source[i + length] === "`") length++;
      if (inline === length) inline = 0;
      else if (!inline) inline = length;
      i += length - 1;
      continue;
    }
    if (inline || source[i] !== "[" || source[i - 1] === "!") continue;
    // Native directive names and Markdown task-list checkboxes are not links.
    const before = source.slice(lastLine, i);
    if (/:[\w-]+$/.test(before)) continue;
    const end = balancedEnd(i, "[", "]");
    if (end < 0) return source.slice(0, i);
    if (end === source.length - 1) {
      if (
        /^\s*(?:[-+*]|\d+[.)])\s+$/.test(before) &&
        /^\[[ xX]\]$/.test(source.slice(i))
      )
        return source;
      return source.slice(0, i);
    }
    const next = source[end + 1];
    if (next === "(" || next === "[") {
      const linkEnd = balancedEnd(end + 1, next, next === "(" ? ")" : "]");
      if (linkEnd < 0) return source.slice(0, i);
      i = linkEnd;
    } else i = end;
  }
  return source;
}
