import { useState } from "react";
import { nativeLinkBrand } from "./nativeLinkBrand";
import { nativeFaviconUrl } from "./nativeFavicon";
import { NativeBrandIcon } from "./NativeBrandIcon";
export function NativeWebsiteIcon({ href }: { href: string }) {
  const brand = nativeLinkBrand(href),
    [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  if (brand) return <NativeBrandIcon brand={brand} />;
  const src = nativeFaviconUrl(href);
  const loaded = src !== null && loadedSrc === src;
  return (
    <span className="codex-native-website-icon">
      {!loaded && <NativeBrandIcon brand="globe" />}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setLoadedSrc(null)}
        />
      )}
    </span>
  );
}
