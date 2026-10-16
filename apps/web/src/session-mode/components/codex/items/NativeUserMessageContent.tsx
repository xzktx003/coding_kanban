import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useAgentInteractionVisible } from "@session/session-dom";
import { REVEAL_USER_MESSAGE_EVENT } from "@session/features/thread-workflows/userMessageDisclosure";
import { NativeChevronDown } from "../presentation/NativeIcons";
import "./native-user-message-content.css";

const COLLAPSED_LINES = 20;
const VISIBLE_LINES = COLLAPSED_LINES - 1;
const CODE_BLOCK = '[data-markdown-copy="code-block"]';
const LINKS = "a[href], area[href]";
const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, audio[controls], video[controls], iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

function lineHeight(element: HTMLElement) {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const size = Number.parseFloat(style.fontSize);
  const line = Number.parseFloat(style.lineHeight);
  return Number.isFinite(line)
    ? line
    : (Number.isFinite(size) ? size : 13) * 1.5;
}
function visibleIn(element: Element, root: Element) {
  const node = element.getBoundingClientRect(),
    clip = root.getBoundingClientRect();
  return element.matches(LINKS)
    ? Math.min(node.right, clip.right) > Math.max(node.left, clip.left) &&
        Math.min(node.bottom, clip.bottom) > Math.max(node.top, clip.top)
    : node.top >= clip.top &&
        node.right <= clip.right &&
        node.bottom <= clip.bottom &&
        node.left >= clip.left;
}
function restore(element: Element, hidden: string | null) {
  element.removeAttribute("inert");
  if (hidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", hidden);
}
function disclosureLabels(locale: string) {
  return locale.startsWith("zh")
    ? ["显示更多", "收起"]
    : locale.startsWith("ja")
      ? ["展開", "折りたたむ"]
      : locale.startsWith("fr")
        ? ["Afficher plus", "Afficher moins"]
        : ["Show more", "Show less"];
}

/** Current VSIX Ft→gt→v and JTr/XTr. Only the mounted text view is clipped. */
export function NativeUserMessageContent({
  text,
  identity,
  children,
}: {
  text: string;
  identity: string;
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  const visible = useAgentInteractionVisible();
  // A scope marker holds no previous body string and cannot survive owner/content replacement.
  const scope = useMemo(() => ({}), [text, identity]);
  const [expandedFor, setExpandedFor] = useState<object | null>(null);
  const [measurement, setMeasurement] = useState<{
    scope: object;
    collapsible: boolean;
  } | null>(null);
  const clip = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const releaseFocus = useRef<(() => void) | null>(null);
  const collapsible = measurement?.scope === scope && measurement.collapsible;
  const collapsed = visible && collapsible && expandedFor !== scope;
  const [more, less] = disclosureLabels(i18n?.language ?? "zh");

  useLayoutEffect(() => {
    const element = body.current;
    if (!element || !visible) return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const threshold = Math.ceil(lineHeight(element) * COLLAPSED_LINES);
      const collapsible =
        Math.floor(element.clientWidth) > 0 &&
        Math.ceil(element.scrollHeight) > threshold + 1;
      setMeasurement((previous) =>
        previous?.scope === scope && previous.collapsible === collapsible
          ? previous
          : { scope, collapsible },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [scope, visible]);

  useLayoutEffect(() => {
    const root = clip.current,
      content = body.current;
    if (!collapsed || !root || !content) return;
    let live = true;
    const update = () => {
      if (
        !live ||
        root.getAttribute("data-native-user-message-collapsed") !== "true"
      )
        return;
      let height = Math.ceil(lineHeight(root) * VISIBLE_LINES);
      const rect = root.getBoundingClientRect();
      const scale =
        root.offsetHeight === 0 ? 1 : rect.height / root.offsetHeight;
      for (const block of root.querySelectorAll(CODE_BLOCK)) {
        const bounds = block.getBoundingClientRect();
        const top = (bounds.top - rect.top) / scale,
          bottom = (bounds.bottom - rect.top) / scale;
        if (top < height && bottom > height) height = Math.ceil(bottom);
      }
      root.style.maxHeight = `${height}px`;
    };
    update();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(content);
    const mutation = new MutationObserver(update);
    mutation.observe(content, { childList: true, subtree: true });
    return () => {
      live = false;
      resize?.disconnect();
      mutation.disconnect();
    };
  }, [collapsed, scope]);

  useEffect(() => {
    const root = clip.current;
    if (!collapsed || !root) return;
    let live = true;
    const tracked = new Map<Element, string | null>();
    const apply = (element: Element, shown: boolean) => {
      if (
        !live ||
        !tracked.has(element) ||
        root.getAttribute("data-native-user-message-collapsed") !== "true"
      )
        return;
      if (shown) restore(element, tracked.get(element)!);
      else {
        element.setAttribute("inert", "");
        element.setAttribute("aria-hidden", "true");
      }
    };
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries)
                apply(
                  entry.target,
                  entry.isIntersecting &&
                    (entry.target.matches(LINKS)
                      ? entry.intersectionRatio > 0
                      : entry.intersectionRatio >= 1),
                );
            },
            { root, rootMargin: "0px", threshold: [Number.EPSILON, 1] },
          );
    const refresh = () => {
      if (!live) return;
      for (const [element, hidden] of tracked)
        if (!root.contains(element)) {
          intersection?.unobserve(element);
          restore(element, hidden);
          tracked.delete(element);
        }
      for (const element of root.querySelectorAll(FOCUSABLE)) {
        if (tracked.has(element) || element.hasAttribute("inert")) continue;
        tracked.set(element, element.getAttribute("aria-hidden"));
        apply(element, intersection === null && visibleIn(element, root));
        intersection?.observe(element);
      }
    };
    refresh();
    const mutation = new MutationObserver(refresh);
    mutation.observe(root, { childList: true, subtree: true });
    const release = () => {
      if (!live) return;
      live = false;
      intersection?.disconnect();
      mutation.disconnect();
      for (const [element, hidden] of tracked) restore(element, hidden);
      tracked.clear();
      if (releaseFocus.current === release) releaseFocus.current = null;
    };
    releaseFocus.current = release;
    return release;
  }, [collapsed, scope]);

  useEffect(() => {
    const root = clip.current;
    if (!collapsed || !root) return;
    const reveal = () => {
      // Search computes its DOM range synchronously; expose the body before it walks clipped links.
      root.removeAttribute("data-native-user-message-collapsed");
      root.style.removeProperty("max-height");
      releaseFocus.current?.();
      setExpandedFor(scope);
    };
    root.addEventListener(REVEAL_USER_MESSAGE_EVENT, reveal);
    return () => root.removeEventListener(REVEAL_USER_MESSAGE_EVENT, reveal);
  }, [collapsed, scope]);

  return (
    <div className="codex-native-user-message-content">
      <div className="codex-native-user-message-text">
        <div
          ref={clip}
          className="codex-native-user-message-clip"
          data-native-user-message-collapsed={collapsed ? "true" : undefined}
          style={collapsed ? { maxHeight: `${VISIBLE_LINES}lh` } : undefined}
        >
          <div ref={body}>{children}</div>
        </div>
        {collapsed && (
          <span aria-hidden="true" data-native-user-message-ellipsis>
            …
          </span>
        )}
      </div>
      {collapsible && visible && (
        <button
          type="button"
          className="codex-native-user-message-disclosure"
          aria-expanded={!collapsed}
          data-thread-find-skip
          data-markdown-copy="exclude"
          onClick={() => setExpandedFor(collapsed ? scope : null)}
        >
          <span>{collapsed ? more : less}</span>
          <NativeChevronDown
            width={12}
            height={12}
            className={collapsed ? undefined : "rotate-180"}
          />
        </button>
      )}
    </div>
  );
}
