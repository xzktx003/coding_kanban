import {
  Children,
  isValidElement,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
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
import { notifyNativeClipboardError } from "@session/features/native-notifications/nativeClipboardError";
import { NativeMarkdownTooltip } from "./NativeMarkdownTooltip";
import { nativeTableClipboardHtml } from "./nativeTableClipboard";
import { writeNativeMarkdownClipboard } from "./nativeMarkdownClipboard";

export const NativeMarkdownSource = createContext("");
type TableFormat = "markdown" | "csv" | "tsv";
type TableChildProps = { children?: ReactNode; node?: { tagName?: string } };
// Native HU reads React children, not text generated inside opaque widgets.
function nativeChildText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<TableChildProps>(child)
          ? nativeChildText(child.props.children)
          : "",
    )
    .join("");
}
function nativeChildRows(children: ReactNode): string[][] {
  const rows: string[][] = [];
  function visit(children: ReactNode, cells?: string[]) {
    for (const child of Children.toArray(children)) {
      if (!isValidElement<TableChildProps>(child)) continue;
      const tag =
        typeof child.type === "string" ? child.type : child.props.node?.tagName;
      if (tag === "tr") {
        const row: string[] = [];
        rows.push(row);
        visit(child.props.children, row);
      } else if (cells && (tag === "th" || tag === "td"))
        cells.push(nativeChildText(child.props.children));
      else visit(child.props.children, cells);
    }
  }
  visit(children);
  return rows;
}
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
  const [pending, setPending] = useState(false);
  const copyLock = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    const rows = Array.from(table.current?.rows ?? []);
    const texts = nativeChildRows(children);
    const lengths: number[] = [];
    for (const row of texts)
      row.forEach((text, index) => {
        lengths[index] = Math.max(lengths[index] ?? 0, text.length);
      });
    rows.forEach((row, rowIndex) =>
      Array.from(row.cells).forEach((cell, index) => {
        const length = lengths[index] ?? 0;
        cell.setAttribute(
          "data-col-size",
          length <= 40
            ? "sm"
            : length <= 100
              ? "md"
              : length <= 160
                ? "lg"
                : "xl",
        );
        cell.setAttribute("dir", "auto");
        cell.toggleAttribute(
          "data-numeric-cell",
          cell.tagName === "TD" && /^\d+$/.test(texts[rowIndex]?.[index] ?? ""),
        );
      }),
    );
  }, [children]);
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
      richHtml: nativeTableClipboardHtml(element),
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
    if (copyLock.current || (format === "markdown" && copied)) return;
    const captured = snapshot(format);
    if (!captured) return;
    copyLock.current = true;
    setPending(true);
    try {
      await writeNativeMarkdownClipboard(captured.text, captured.richHtml);
      // Streaming can replace rows while an asynchronous permission prompt is open.
      if (
        !mounted.current ||
        table.current !== captured.element ||
        captured.richHtml !== nativeTableClipboardHtml(table.current)
      )
        return;
      setCopied(true);

      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      notifyNativeClipboardError(i18n.language ?? "zh");
    } finally {
      copyLock.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const scrollWithKeyboard = (event: KeyboardEvent) => {
    const element = scroller.current;
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.altKey && !(navigator.platform ?? "").startsWith("Mac")) ||
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      !element ||
      element.scrollWidth <= element.clientWidth
    )
      return;
    event.preventDefault();
    element.scrollBy({
      left:
        (event.key === "ArrowLeft" ? -1 : 1) *
        (event.altKey ? element.clientWidth : 40),
    });
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
      >
        <div className="codex-native-table-wrapper">
          <table {...props} ref={table} dir="auto" data-streamdown="table">
            {children}
          </table>
        </div>
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
        <NativeMarkdownTooltip
          label={copied ? labels.copied : labels.copyTable}
        >
          <button
            type="button"
            aria-label={copied ? labels.copied : labels.copyTable}
            aria-busy={pending || undefined}
            aria-disabled={pending || undefined}
            data-copied={copied || undefined}
            onKeyDown={scrollWithKeyboard}
            onClick={
              copied
                ? undefined
                : (event) => {
                    event.stopPropagation();
                    void copy();
                  }
            }
          >
            <NativeMarkdownIcon name={copied ? "check" : "copy"} />
          </button>
        </NativeMarkdownTooltip>
      </div>
    </div>
  );
}
