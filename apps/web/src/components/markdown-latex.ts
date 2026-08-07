interface MarkdownFence {
  marker: "`" | "~";
  length: number;
}

function normalizeInlineLatexDelimiters(line: string): string {
  let output = "";
  let codeTickLength = 0;
  let index = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      let tickEnd = index + 1;
      while (line[tickEnd] === "`") {
        tickEnd += 1;
      }
      const tickLength = tickEnd - index;
      if (codeTickLength === 0) {
        codeTickLength = tickLength;
      } else if (codeTickLength === tickLength) {
        codeTickLength = 0;
      }
      output += line.slice(index, tickEnd);
      index = tickEnd;
      continue;
    }

    const isUnescapedDelimiter = index === 0 || line[index - 1] !== "\\";
    if (
      codeTickLength === 0 &&
      isUnescapedDelimiter &&
      (line.startsWith("\\(", index) || line.startsWith("\\)", index))
    ) {
      output += "$";
      index += 2;
      continue;
    }

    output += line[index];
    index += 1;
  }

  return output;
}

export function normalizeLatexMathDelimiters(content: string): string {
  let fence: MarkdownFence | null = null;

  return content
    .split(/(\r?\n)/)
    .map((line) => {
      if (line === "\n" || line === "\r\n") {
        return line;
      }

      const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as MarkdownFence["marker"];
        const markerLength = fenceMatch[1].length;
        if (fence) {
          if (
            marker === fence.marker &&
            markerLength >= fence.length &&
            fenceMatch[2].trim() === ""
          ) {
            fence = null;
          }
        } else {
          fence = { marker, length: markerLength };
        }
        return line;
      }

      if (fence || /^(?: {4}|\t)/.test(line)) {
        return line;
      }

      const blockStart = /^(\s*)\\\[(\s*)$/.exec(line);
      if (blockStart) {
        return `${blockStart[1]}$$${blockStart[2]}`;
      }

      const blockEnd = /^(\s*)\\\](\s*)$/.exec(line);
      if (blockEnd) {
        return `${blockEnd[1]}$$${blockEnd[2]}`;
      }

      return normalizeInlineLatexDelimiters(line);
    })
    .join("");
}
