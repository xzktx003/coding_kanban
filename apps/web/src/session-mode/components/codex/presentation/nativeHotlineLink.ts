const marker = "oai_link_source=model_response_hotline";

/** VSIX Cni/wni removes only the exact, standalone hotline query token. */
export function nativeHotlineLink(href: string) {
  if (!href.includes(marker)) return null;
  try {
    const parsed = new URL(href);
    if (!["http:", "https:", "sms:", "tel:"].includes(parsed.protocol))
      return null;
    const query = parsed.search.slice(1).split("&");
    if (!query.includes(marker)) return null;
    parsed.search = query.filter((value) => value !== marker).join("&");
    return parsed.toString();
  } catch {
    return null;
  }
}
