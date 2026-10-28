import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Tiers and thresholds from the shipped 26.51007.21434 webview. Official sizes
 * footer labels against the footer's own inline size rather than the viewport:
 * `_ComposerLayoutFooter_boifs_2[data-composer-footer-responsive]` declares
 * `container: composer-footer/inline-size`, and `app-initial-f5b2ced5ef25.css`
 * hides each tier at `width<=300px` (xs) and `width<=440px` (sm, secondary).
 *
 * We measure in JS instead of porting the container query, for two reasons:
 * jsdom does not evaluate `@container` at all, so a CSS-only port cannot be
 * held to a test and would rot silently; and the controls need to *read* their
 * own tier to decide what to render, not only to be hidden by a stylesheet.
 *
 * The 475/480/520px variants in that stylesheet are
 * `[data-codex-window-type=electron|browser]` overrides. The extension webview
 * sets `dataset.codexWindowType = "extension"`, so the base tiers govern the
 * surface we mirror.
 */
const COLLAPSE_THRESHOLD = { xs: 300, sm: 440, secondary: 440, none: 0 };

export type ComposerFooterCollapse = keyof typeof COLLAPSE_THRESHOLD;

/**
 * `null` means "not measured yet". A footer inside a hidden tab reports width 0
 * before its first layout, and collapsing on that would strip the labels off a
 * composer nobody has opened — they would only come back on a later resize. An
 * unmeasured footer is therefore treated as wide.
 */
const ComposerFooterWidthContext = createContext<number | null>(null);

const NARROW_THRESHOLD = 420;

const ComposerToolbarNarrowContext = createContext(false);

/**
 * Wraps the composer's bottom toolbar row and observes its own width.
 * Descendant controls read `useComposerFooterCollapsed()` (per-tier, mirroring
 * official) or `useComposerToolbarNarrow()` (single legacy threshold).
 */
export function ComposerToolbarProvider({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} data-composer-footer-responsive="">
      <ComposerFooterWidthContext.Provider value={width}>
        <ComposerToolbarNarrowContext.Provider
          value={width !== null && width > 0 && width < NARROW_THRESHOLD}
        >
          {children}
        </ComposerToolbarNarrowContext.Provider>
      </ComposerFooterWidthContext.Provider>
    </div>
  );
}

/** True once the footer is narrow enough to hide labels of this tier. */
export function useComposerFooterCollapsed(collapse: ComposerFooterCollapse) {
  const width = useContext(ComposerFooterWidthContext);
  if (collapse === "none") return false;
  // Width 0 is an unlaid-out footer, not a 0px one — see the context comment.
  if (width === null || width <= 0) return false;
  return width <= COLLAPSE_THRESHOLD[collapse];
}

/**
 * A footer label that disappears at its tier. Mirrors official's `vHi`, which
 * renders a `<span data-composer-footer-collapse={collapse}>`; we keep that
 * attribute on the collapsed element too, so a stylesheet-side port of the same
 * tiers would still have something to match.
 */
export function ComposerFooterLabel({
  collapse,
  className,
  children,
}: {
  collapse: ComposerFooterCollapse;
  className?: string;
  children: ReactNode;
}) {
  const collapsed = useComposerFooterCollapsed(collapse);
  return (
    <span
      className={className}
      data-composer-footer-collapse={collapse}
      data-composer-footer-collapsed={collapsed ? "true" : undefined}
    >
      {collapsed ? null : children}
    </span>
  );
}

export function useComposerToolbarNarrow() {
  return useContext(ComposerToolbarNarrowContext);
}
