import { useId, useLayoutEffect, useRef, useState } from "react";

/** The plugin's three-line command preview, expanded to a bounded 320px scroll area. */
export function NativeTextPreview({
  text,
  expandLabel,
  collapseLabel,
}: {
  text: string;
  expandLabel: string;
  collapseLabel: string;
}) {
  const id = useId();
  const ref = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(text.split("\n").length > 3);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight,
      );
      setLong(
        text.split("\n").length > 3 ||
          (Number.isFinite(lineHeight) &&
            element.scrollHeight > lineHeight * 3 + 1),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div className="codex-command-preview" data-expanded={expanded}>
      <div className="codex-command-preview-scroll">
        <pre
          ref={ref}
          id={id}
          className={!expanded && long ? "is-clamped" : undefined}
        >
          {text}
        </pre>
      </div>
      {long && (
        <div className="codex-command-preview-footer">
          <button
            type="button"
            aria-controls={id}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? collapseLabel : expandLabel}
          </button>
        </div>
      )}
    </div>
  );
}
