// Protect Markdown code before looking for TeX delimiters. This is deliberately
// conservative: ambiguous currency and incomplete expressions stay plain text.
function transform(text, visit) {
  let output = "";
  let fence = null;
  let index = 0;
  while (index < text.length) {
    if (index === 0 || text[index - 1] === "\n") {
      const end = text.indexOf("\n", index);
      const line = text.slice(index, end < 0 ? text.length : end + 1);
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
      if (marker || fence || /^( {4}|\t)/.test(line)) {
        if (marker && !fence) fence = marker[1];
        else if (
          marker &&
          marker[1][0] === fence?.[0] &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = null;
        output += line;
        index += line.length;
        continue;
      }
    }
    if (text[index] === "`") {
      const marker = text.slice(index).match(/^`+/)[0];
      const end = text.indexOf(marker, index + marker.length);
      const next = end < 0 ? index + marker.length : end + marker.length;
      output += text.slice(index, next);
      index = next;
      continue;
    }
    const opening = ["$$", "\\[", "\\(", "$"].find((value) =>
      text.startsWith(value, index),
    );
    if (opening) {
      const closing =
        opening === "\\[" ? "\\]" : opening === "\\(" ? "\\)" : opening;
      let end = text.indexOf(closing, index + opening.length);
      while (end >= 0 && text[end - 1] === "\\")
        end = text.indexOf(closing, end + closing.length);
      if (end >= 0) {
        const formula = text.slice(index + opening.length, end);
        const valid =
          formula.trim() &&
          (opening !== "$" ||
            (!/^\s|\s$/.test(formula) &&
              !formula.includes("\n") &&
              !/^\d[\d,.]*$/.test(formula) &&
              !/\d/.test(text[end + 1] ?? "")));
        if (valid) {
          const original = text.slice(index, end + closing.length);
          output += visit(formula.trim(), original);
          index = end + closing.length;
          continue;
        }
      }
      output += opening;
      index += opening.length;
      continue;
    }
    // Consume escaped punctuation together so \$ never opens math.
    const length = text[index] === "\\" ? Math.min(2, text.length - index) : 1;
    output += text.slice(index, index + length);
    index += length;
  }
  return output;
}

export function findFormulas(text) {
  const formulas = new Set();
  transform(text, (formula, original) => {
    formulas.add(formula);
    return original;
  });
  return [...formulas];
}

export function replaceFormulas(text, images) {
  return transform(text, (formula, original) => {
    const key = images.get(formula);
    if (typeof key !== "string" || !/^img_[A-Za-z0-9_-]+$/.test(key))
      return original;
    const alt =
      formula.length <= 80
        ? formula.replace(
            /[&<>\[\]\\\n\r]/g,
            (value) => `&#${value.charCodeAt(0)};`,
          )
        : "公式（点击放大）";
    return `![${alt}](${key})`;
  });
}
