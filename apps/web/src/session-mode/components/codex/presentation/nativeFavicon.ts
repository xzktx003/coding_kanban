/** Native xNi deliberately sends just the HTTP origin to the favicon provider. */
export function nativeFaviconUrl(href: string): string | null {
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol)
      ? `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url.origin)}&size=32&drop_404_icon=true`
      : null;
  } catch {
    return null;
  }
}
