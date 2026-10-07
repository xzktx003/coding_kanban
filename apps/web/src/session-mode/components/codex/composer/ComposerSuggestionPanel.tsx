import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  useAgentInteractionVisible,
  sessionPortalContainer,
} from "@session/session-dom";
import { suggestionPosition } from "./suggestionPosition";
import "./composer-suggestions.css";

export function ComposerSuggestionPanel({
  kind,
  count,
  children,
  style,
}: {
  kind: "commands" | "mentions";
  count: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { t } = useTranslation("thread");
  const interactionVisible = useAgentInteractionVisible();
  if (!interactionVisible) return null;
  return (
    <div
      className="composer-suggestions"
      data-composer-suggestions={kind}
      data-compact={
        typeof style?.maxHeight === "number" && style.maxHeight < 180
      }
      style={style}
    >
      <header className="composer-suggestions-heading">
        <span className="composer-suggestions-symbol" aria-hidden="true">
          {kind === "commands" ? "/" : "$"}
        </span>
        <div>
          <strong>{t(`suggestions.${kind}`)}</strong>
          <span>{t(`suggestions.${kind}Hint`)}</span>
        </div>
        <span className="composer-suggestions-count">{count}</span>
      </header>
      <div
        className="composer-suggestions-list"
        role="listbox"
        aria-label={t(`suggestions.${kind}`)}
      >
        {count > 0 ? (
          children
        ) : (
          <div className="composer-suggestions-empty">
            {t("suggestions.empty")}
          </div>
        )}
      </div>
      <footer className="composer-suggestions-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t("suggestions.navigate")}
        </span>
        <span>
          <kbd>↵</kbd> {t("suggestions.select")}
        </span>
        <span>
          <kbd>esc</kbd> {t("suggestions.close")}
        </span>
      </footer>
    </div>
  );
}

export function ComposerSuggestionPopover({
  anchor,
  ...props
}: {
  anchor: HTMLElement | null;
  kind: "commands" | "mentions";
  count: number;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!anchor) return;
    let frame = 0;
    const update = () => {
      const viewport = window.visualViewport;
      const rect = anchor.getBoundingClientRect();
      setStyle(
        suggestionPosition(rect, {
          left: viewport?.offsetLeft ?? 0,
          top: viewport?.offsetTop ?? 0,
          width: viewport?.width ?? window.innerWidth,
          height: viewport?.height ?? window.innerHeight,
          layoutHeight: window.innerHeight,
        }),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchor]);
  const container = sessionPortalContainer();
  if (!container || !anchor || !style) return null;
  return createPortal(
    <ComposerSuggestionPanel {...props} style={style} />,
    container,
  );
}
