const escaped = (text: string, index: number) => {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
};

/** Adapt the plugin's LaTeX delimiters to KaTeX while keeping literal dollars and code. */
export function nativeMathMarkdown(text: string): string {
  let result = "",
    index = 0,
    inlineTicks = 0;
  let fence: { character: string; length: number } | null = null;
  while (index < text.length) {
    if (index === 0 || text[index - 1] === "\n") {
      const end = text.indexOf("\n", index);
      const stop = end < 0 ? text.length : end + 1;
      const line = text.slice(index, stop);
      const marker = line.match(
        /^(?: {0,3}>[ \t]?)*[ \t]{0,3}(?:[-+*] |\d+[.)] )?(`{3,}|~{3,})/,
      );
      if (fence || marker || /^ {4}\S|^\t/.test(line)) {
        if (marker) {
          const run = marker[1];
          if (!fence) fence = { character: run[0], length: run.length };
          else if (
            run[0] === fence.character &&
            run.length >= fence.length &&
            !line.slice(marker[0].length).trim()
          )
            fence = null;
        }
        result += line;
        index = stop;
        continue;
      }
    }
    if (text[index] === "`" && !escaped(text, index)) {
      let end = index + 1;
      while (text[end] === "`") end++;
      const count = end - index;
      if (inlineTicks === 0) inlineTicks = count;
      else if (inlineTicks === count) inlineTicks = 0;
      result += text.slice(index, end);
      index = end;
      continue;
    }
    if (
      !inlineTicks &&
      text[index] === "\\" &&
      !escaped(text, index) &&
      ["(", "["].includes(text[index + 1])
    ) {
      const display = text[index + 1] === "[";
      const closing = display ? "\\]" : "\\)";
      let end = text.indexOf(closing, index + 2);
      while (end >= 0 && escaped(text, end))
        end = text.indexOf(closing, end + 2);
      if (end >= 0) {
        const value = text.slice(index + 2, end);
        result += display ? `\n$$\n${value}\n$$\n` : `$${value}$`;
        index = end + 2;
        continue;
      }
    }
    if (!inlineTicks && text[index] === "$" && !escaped(text, index))
      result += "\\";
    result += text[index++];
  }
  return result;
}
