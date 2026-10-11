// VSIX yL copies document structure, not UI attributes or computed styles.
const attributes: Record<string, readonly string[]> = {
  A: ["href", "title"],
  BLOCKQUOTE: ["cite"],
  IMG: ["src", "srcset", "sizes", "alt", "title", "width", "height"],
  LI: ["value"],
  OL: ["start"],
  Q: ["cite"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"],
  TIME: ["datetime"],
};

export function nativeTableClipboardHtml(table: HTMLTableElement): string {
  const doc = table.ownerDocument;
  function copy(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
    if (!(node instanceof Element)) return null;
    if (
      node.matches(
        '.sr-only, [aria-hidden="true"], [data-markdown-copy="exclude"], img[alt=""]',
      )
    )
      return null;
    if (node.namespaceURI !== "http://www.w3.org/1999/xhtml")
      return node.textContent?.trim()
        ? doc.createTextNode(node.textContent)
        : null;
    if (node.matches("button, [data-file-reference]"))
      return doc.createTextNode(node.textContent ?? "");
    const inlineCode = node.matches(
      '[data-streamdown="inline-code"], [data-md-copy="inline-code"], [data-markdown-copy="inline-code"]',
    );
    const output = node.matches('[data-markdown-copy="contents"]')
      ? doc.createDocumentFragment()
      : doc.createElement(inlineCode ? "code" : node.tagName.toLowerCase());
    if (output instanceof Element) {
      if (inlineCode) output.setAttribute("dir", "ltr");
      for (const attr of attributes[node.tagName] ?? []) {
        const value = node.getAttribute(attr);
        if (value !== null) output.setAttribute(attr, value);
      }
    }
    for (const child of node.childNodes) {
      const clean = copy(child);
      if (clean) output.appendChild(clean);
    }
    return output;
  }
  const container = doc.createElement("div");
  const clean = copy(table);
  if (clean) container.appendChild(clean);
  return container.innerHTML;
}
