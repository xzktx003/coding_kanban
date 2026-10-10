import { useId, type ReactNode } from "react";
import { useTranscriptState } from "../thread/rowState";
import { NativeCadencedShimmer } from "../presentation/NativeCadencedShimmer";
import { NativeCommandChevron } from "../presentation/NativeCommandIcons";
import "./tool-native.css";
/** Native tool disclosure: compact header, deliberate expansion, persisted per row. */
export function NativeToolDisclosure({
  icon,
  summary,
  label: accessibleLabel,
  running = false,
  children,
  className = "",
  defaultExpanded = false,
}: {
  icon?: ReactNode;
  summary: ReactNode;
  label?: string;
  running?: boolean;
  children?: ReactNode;
  className?: string;
  defaultExpanded?: boolean;
}) {
  const id = useId(),
    [expanded, setExpanded] = useTranscriptState(
      "native-tool-expanded",
      defaultExpanded,
    );
  const body = children != null;
  const label = (
    <span className="codex-native-tool-label">
      {running ? (
        <NativeCadencedShimmer>{summary}</NativeCadencedShimmer>
      ) : (
        summary
      )}
    </span>
  );
  return (
    <div className={`codex-native-tool ${className}`}>
      <div className="codex-native-tool-header">
        {body && (
          <button
            type="button"
            className="codex-native-tool-toggle"
            aria-controls={id}
            aria-expanded={expanded}
            aria-label={
              accessibleLabel ??
              (typeof summary === "string" ? summary : undefined)
            }
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="sr-only">{accessibleLabel ?? summary}</span>
          </button>
        )}
        {icon}
        {label}
        {body && (
          <NativeCommandChevron
            data-expanded={expanded}
            className={
              expanded
                ? "codex-command-chevron is-expanded"
                : "codex-command-chevron"
            }
          />
        )}
      </div>
      {body && (
        <div
          id={id}
          className="codex-native-tool-body"
          hidden={!expanded}
          inert={!expanded}
        >
          {expanded && children}
        </div>
      )}
    </div>
  );
}
