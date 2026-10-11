// Enabled VSIX hBi/tBi and qXn/UXn. Render through an inert image resource,
// not inline SVG/HTML, and normalize legacy xlink references for image loading.
export function isNativeSvgPreview(code: string, language: string): boolean {
  return (
    language === "svg" ||
    ((language === "xml" || language === "html") && /^\s*<svg/.test(code))
  );
}

export function nativeSvgPreviewSource(code: string): string | null {
  const template = document.createElement("template");
  template.innerHTML = code.replace(/<\/?\s*$/, "");
  const xlink = "http://www.w3.org/1999/xlink";
  for (const element of template.content.querySelectorAll("[*|href]")) {
    const reference = element.getAttributeNS(xlink, "href");
    if (reference === null) continue;
    if (!element.hasAttribute("href")) element.setAttribute("href", reference);
    element.removeAttributeNS(xlink, "href");
  }
  const markup = template.innerHTML;
  return markup
    ? `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`
    : null;
}
