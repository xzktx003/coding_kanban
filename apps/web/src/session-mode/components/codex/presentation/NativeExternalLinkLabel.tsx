import { useState, type ReactNode } from "react";
import { NativeBrandIcon } from "./NativeBrandIcon";
import { nativeFaviconUrl } from "./nativeFavicon";
import { nativeLinkBrand } from "./nativeLinkBrand";

export function NativeExternalLinkLabel({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const brand = href ? nativeLinkBrand(href) : null;
  const favicon = href && !brand ? nativeFaviconUrl(href) : null;
  const loaded = !!favicon && loadedSrc === favicon;
  return (
    <span className="codex-native-external-link-label">
      {href ? (
        <span className="codex-native-link-icon" data-markdown-copy="exclude">
          <span className="codex-native-favicon">
            {!loaded && (
              <span className="codex-native-favicon-fallback">
                {brand ? (
                  <NativeBrandIcon brand={brand} />
                ) : (
                  <NativeBrandIcon brand="globe" />
                )}
              </span>
            )}
            {favicon && (
              <img
                key={favicon}
                src={favicon}
                alt=""
                decoding="async"
                draggable={false}
                referrerPolicy="no-referrer"
                style={{ opacity: loaded ? 1 : 0 }}
                onLoad={() => setLoadedSrc(favicon)}
                onError={() => setLoadedSrc(null)}
              />
            )}
          </span>
        </span>
      ) : null}
      <span className="codex-native-link-text">{children}</span>
    </span>
  );
}
