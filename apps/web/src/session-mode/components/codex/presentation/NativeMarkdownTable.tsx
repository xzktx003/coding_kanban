import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { downloadNativeText } from "./NativeCodeFence";
import { NativeMarkdownIcon } from "./NativeMarkdownIcons";
import { nativeMarkdownLabels } from "./nativeMarkdownLabels";

export const NativeMarkdownSource = createContext("");
type TableFormat = "markdown" | "csv" | "tsv";
export function serializeNativeTable(
  table: HTMLTableElement,
  format: TableFormat,
): string {
  const rows = Array.from(table.rows, (row) =>
    Array.from(row.cells, (cell) => cell.textContent ?? ""),
  );
  if (format !== "markdown") {
    const separator = format === "csv" ? "," : "\t";
    return rows
      .map((row) =>
        row
          .map((cell) =>
            /["\n\r]/.test(cell) || cell.includes(separator)
              ? `"${cell.replaceAll('"', '""')}"`
              : cell,
          )
          .join(separator),
      )
      .join("\n");
  }
  const line = (row: string[]) =>
    `| ${row.map((cell) => cell.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>")).join(" | ")} |`;
  return rows.length
    ? [
        line(rows[0]),
        line(rows[0].map(() => "---")),
        ...rows.slice(1).map(line),
      ].join("\n")
    : "";
}

export function NativeMarkdownTable({
  children,
  sourceStart,
  sourceEnd,
  ...props
}: ComponentProps<"table"> & { sourceStart?: number; sourceEnd?: number }) {
  const { i18n } = useTranslation();
  const labels = nativeMarkdownLabels(i18n.language ?? "zh");
  const source = useContext(NativeMarkdownSource);
  const table = useRef<HTMLTableElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setOverflow(element.scrollWidth > element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (table.current) observer.observe(table.current);
    return () => observer.disconnect();
  }, [children]);
  const snapshot = (format: TableFormat) => {
    const element = table.current;
    if (!element) return null;
    return {
      element,
      html: element.outerHTML,
      text:
        format === "markdown" &&
        sourceStart !== undefined &&
        sourceEnd !== undefined &&
        sourceEnd <= source.length
          ? source.slice(sourceStart, sourceEnd)
          : serializeNativeTable(element, format),
    };
  };
  const copy = async (format: TableFormat = "markdown") => {
    const captured = snapshot(format);
    if (!captured) return;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([captured.text], { type: "text/plain" }),
            "text/html": new Blob([captured.html], { type: "text/html" }),
          }),
        ]);
      } else await navigator.clipboard.writeText(captured.text);
      // Streaming can replace rows while an asynchronous permission prompt is open.
      if (
        !mounted.current ||
        table.current !== captured.element ||
        captured.html !== table.current.outerHTML
      )
        return;
      setCopied(true);
      setError(null);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      if (
        mounted.current &&
        table.current === captured.element &&
        captured.html === table.current.outerHTML
      )
        setError(error instanceof Error ? error.message : labels.failed);
    }
  };
  const download = (format: TableFormat) => {
    const captured = snapshot(format);
    if (captured)
      downloadNativeText(
        captured.text,
        `table.${format === "markdown" ? "md" : format}`,
        format === "markdown"
          ? "text/markdown"
          : format === "csv"
            ? "text/csv"
            : "text/tab-separated-values",
      );
  };
  return (
    <div
      className="codex-native-table"
      data-streamdown="table-wrapper"
      data-markdown-table=""
    >
      <div
        className="codex-native-table-scroller"
        ref={scroller}
        role={overflow ? "region" : undefined}
        aria-label={overflow ? labels.scrollTable : undefined}
        tabIndex={overflow ? 0 : undefined}
        onKeyDown={(event) => {
          if (
            !overflow ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            !["ArrowLeft", "ArrowRight"].includes(event.key)
          )
            return;
          event.preventDefault();
          scroller.current?.scrollBy({
            left:
              (event.key === "ArrowLeft" ? -1 : 1) *
              (event.altKey ? scroller.current.clientWidth : 40),
          });
        }}
      >
        <table {...props} ref={table} data-streamdown="table">
          {children}
        </table>
      </div>
      <div className="codex-native-table-actions" data-markdown-copy="exclude">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="codex-native-markdown-more"
              aria-label={labels.moreTable}
              title={labels.moreTable}
            >
              <NativeMarkdownIcon name="more" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="codex-presentation codex-native-markdown-menu">
            {(["csv", "tsv"] as const).map((format) => (
              <DropdownMenuItem
                key={`copy-${format}`}
                onSelect={() => void copy(format)}
              >
                {labels.copy} · {format.toUpperCase()}
              </DropdownMenuItem>
            ))}
            {(["csv", "tsv", "markdown"] as const).map((format) => (
              <DropdownMenuItem
                key={`download-${format}`}
                onSelect={() => download(format)}
              >
                {labels.download} ·{" "}
                {format === "markdown" ? "Markdown" : format.toUpperCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={copied ? labels.copied : labels.copyTable}
          title={copied ? labels.copied : labels.copyTable}
          onClick={() => void copy()}
        >
          <NativeMarkdownIcon name={copied ? "check" : "copy"} />
        </button>
      </div>
      {error ? (
        <div className="codex-native-markdown-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
