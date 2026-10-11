// Match the VSIX Mpt/yL DOM copy rules. Only a click reads the mounted body;
// neither the serializer nor the copy button retains another transcript cache.
const allowedAttributes: Record<string, readonly string[]> = {
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
const blocks = new Set([
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
  "PRE",
]);
export function nativeMessageClipboard(
  root: HTMLElement,
  options: { kind?: "user" | "assistant" } = {},
): { text: string; html: string } | null {
  const doc = root.ownerDocument;
  const fragment = doc.createDocumentFragment();
  const math = (source: string, display: boolean) => {
    if (display) source = source.trim();
    const span = doc.createElement("span");
    span.setAttribute("data-math-source", source);
    span.setAttribute("data-math-display", String(display));
    span.textContent = display ? `\\[\n${source}\n\\]` : `\\(${source}\\)`;
    return span;
  };
  function append(parent: Node, node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (
        /\n/.test(node.textContent ?? "") &&
        !(node.textContent ?? "").trim() &&
        node.parentElement?.matches(
          "div, ul, ol, table, thead, tbody, tfoot, tr",
        )
      )
        return;
      // Native Markdown wraps text tokens in spans; Streamdown emits text nodes.
      const span =
        options.kind === "assistant"
          ? doc.createTextNode("")
          : doc.createElement("span");
      const text = node.textContent ?? "";
      span.textContent =
        node.previousSibling instanceof Element &&
        node.previousSibling.matches(
          'input[type="checkbox"], [role="checkbox"]',
        ) &&
        text.startsWith(" ")
          ? text.slice(1)
          : text;
      parent.appendChild(span);
      return;
    }
    if (!(node instanceof Element)) return;
    if (
      node.matches(
        '.sr-only, [aria-hidden="true"], [data-markdown-copy="exclude"], img[alt=""], script, style, noscript',
      )
    )
      return;
    const mode = node.getAttribute("data-markdown-copy");
    if (mode === "contents") {
      for (const child of node.childNodes) append(parent, child);
      return;
    }
    if (node.matches("button, [data-file-reference]")) {
      parent.appendChild(
        doc.createTextNode(
          node.getAttribute("data-markdown-copy-text") ??
            node.textContent ??
            "",
        ),
      );
      return;
    }
    if (node.matches(".katex-display, .katex, [data-math-source]")) {
      const source =
        node.getAttribute("data-math-source") ??
        node.querySelector('annotation[encoding="application/x-tex"]')
          ?.textContent;
      if (source !== null && source !== undefined) {
        parent.appendChild(
          math(
            source,
            node.classList.contains("katex-display") ||
              node.getAttribute("data-math-display") === "true",
          ),
        );
        return;
      }
    }
    if (
      mode === "code-block" ||
      node.matches('[data-streamdown="code-block"]')
    ) {
      const pre = doc.createElement("pre");
      pre.dir = "ltr";
      const code = doc.createElement("code");
      code.textContent =
        node.getAttribute("data-markdown-copy-text") ??
        node.querySelector("pre code")?.textContent ??
        "";
      pre.append(code);
      parent.appendChild(pre);
      return;
    }
    if (mode === "rich-block") {
      const body = node.querySelector("[data-markdown-copy-content]");
      if (body) append(parent, body);
      return;
    }
    if (
      node.matches(
        'code, [data-streamdown="inline-code"], [data-markdown-copy="inline-code"]',
      )
    ) {
      const code = doc.createElement("code");
      code.dir = "ltr";
      code.textContent = node.textContent;
      parent.appendChild(code);
      return;
    }
    if (node.matches('input[type="checkbox"], [role="checkbox"]')) {
      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = true;
      if (
        node.hasAttribute("checked") ||
        node.getAttribute("aria-checked") === "true"
      )
        checkbox.setAttribute("checked", "");
      parent.appendChild(checkbox);
      return;
    }
    if (node.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      if (node.textContent)
        parent.appendChild(doc.createTextNode(node.textContent));
      return;
    }
    const element = doc.createElement(node.localName);
    for (const attribute of allowedAttributes[node.tagName] ?? []) {
      const value = node.getAttribute(attribute);
      if (value !== null) element.setAttribute(attribute, value);
    }
    for (const child of node.childNodes) append(element, child);
    parent.appendChild(element);
  }
  const body =
    options.kind === "assistant"
      ? (root.querySelector(".codex-markdown-blocks") ?? root)
      : root;
  for (const node of body.childNodes) append(fragment, node);
  const inner = (node: Node): string =>
    Array.from(node.childNodes).map(plain).join("");
  const row = (node: Element) =>
    Array.from(node.children)
      .filter((e) => e.matches("th,td"))
      .map((e) => inner(e).trim())
      .join("\t");
  function list(node: Element, indent: string): string {
    let index = node instanceof HTMLOListElement ? node.start : 1;
    return Array.from(node.children)
      .filter((e) => e.tagName === "LI")
      .map((item) => {
        if (item instanceof HTMLLIElement && item.hasAttribute("value"))
          index = item.value;
        const prefix = node.tagName === "OL" ? `${index++}. ` : "- ";
        const nextIndent = indent + " ".repeat(prefix.length);
        let pending = "",
          result = "",
          started = false;
        const flush = () => {
          const lines = pending.trim().split("\n");
          pending = "";
          if (lines.length === 1 && lines[0] === "") return;
          for (const line of lines) {
            result += `${started ? nextIndent : indent + prefix}${line}\n`;
            started = true;
          }
        };
        for (const child of item.childNodes) {
          if (child instanceof Element && child.matches("ol,ul")) {
            flush();
            if (!started) {
              result += `${indent}${prefix.trimEnd()}\n`;
              started = true;
            }
            result += list(child, nextIndent);
          } else pending += plain(child);
        }
        flush();
        return started ? result : `${indent}${prefix.trimEnd()}\n`;
      })
      .join("");
  }
  function plain(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    switch (node.tagName) {
      case "INPUT":
        return node.getAttribute("type") === "checkbox"
          ? `[${node.hasAttribute("checked") ? "x" : " "}] `
          : "";
      case "TABLE":
        return Array.from(node.querySelectorAll("tr")).map(row).join("\n");
      case "TR":
        return `${row(node)}\n`;
      case "TD":
      case "TH":
        return `${inner(node).trim()}\t`;
      case "BR":
        return "\n";
      case "OL":
      case "UL":
        return list(node, "");
      default:
        return blocks.has(node.tagName) ||
          node.getAttribute("data-math-display") === "true"
          ? `${inner(node)}\n`
          : inner(node);
    }
  }
  const text = inner(fragment).trim();
  if (!text) return null;
  const container = doc.createElement("div");
  container.append(fragment);
  for (const span of container.querySelectorAll("[data-math-source]")) {
    const value = span.getAttribute("data-math-source") ?? "";
    span.textContent =
      span.getAttribute("data-math-display") === "true"
        ? `\\[\n${value}\n\\]`
        : `\\(${value}\\)`;
  }
  return { text, html: container.innerHTML };
}
