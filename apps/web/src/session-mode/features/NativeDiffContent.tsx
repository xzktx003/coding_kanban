import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { diffWordsWithSpace } from "diff";
import { codexCode } from "@session/components/codex/presentation/codexCode";
import type { HighlightResult } from "@streamdown/code";
import { nativeSplitLines } from "./nativeSplitLines";
import type { DiffLine } from "./nativeDiffLines";
import { selectNativeDiffRange, type NativeDiffSelection } from "./nativeDiffSelection";
import "./git/review-native.css";

const languages: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  rs: "rust",
  go: "go",
  sh: "shellscript",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  html: "html",
  toml: "toml",
};
type Range = [number, number];
function wordRanges(lines: DiffLine[]) {
  const ranges = new Map<number, Range[]>();
  let remaining = 200000;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].type !== "remove") continue;
    let end = index;
    while (end < lines.length && lines[end].type === "remove") end++;
    let addEnd = end;
    while (addEnd < lines.length && lines[addEnd].type === "add") addEnd++;
    for (let pair = 0; pair < Math.min(end - index, addEnd - end); pair++) {
      const before = lines[index + pair].content, after = lines[end + pair].content;
      if (before.length + after.length > 8192 || remaining < before.length + after.length) continue;
      remaining -= before.length + after.length;
      const removed: Range[] = [],
        added: Range[] = [];
      let old = 0,
        next = 0;
      for (const change of diffWordsWithSpace(
        before,
        after,
        { maxEditLength: 512 },
      ) ?? []) {
        if (!change.added) {
          if (change.removed) removed.push([old, old + change.value.length]);
          old += change.value.length;
        }
        if (!change.removed) {
          if (change.added) added.push([next, next + change.value.length]);
          next += change.value.length;
        }
      }
      ranges.set(index + pair, removed);
      ranges.set(end + pair, added);
    }
    index = addEnd - 1;
  }
  return ranges;
}

export function NativeDiffContent({
  lines,
  path,
  hunkHeaders = true,
  split = false,
  onSelectLines,
  onOpenLine,
  selection,
  renderAnnotation,
  renderHunkActions,
  wrap = false,
  hunkPresentation = "raw",
}: {
  lines: DiffLine[];
  path?: string;
  hunkHeaders?: boolean;
  split?: boolean;
  onSelectLines?: (selection: NativeDiffSelection) => void;
  onOpenLine?: (location: { side: "old" | "new"; line: number }) => void;
  selection?: NativeDiffSelection | null;
  renderAnnotation?: (location: { side: "old" | "new"; line: number }) => ReactNode;
  renderHunkActions?: (hunkIndex: number) => ReactNode;
  wrap?: boolean;
  hunkPresentation?: "raw" | "line-info";
}) {
  const [highlight, setHighlight] = useState<{ old: HighlightResult | null; new: HighlightResult | null }>({ old: null, new: null });
  const sources = useMemo(() => {
    const old: string[] = [], next: string[] = [], oldIndexes: number[] = [], newIndexes: number[] = [];
    lines.forEach((line, index) => {
      if (line.separator) return;
      if (line.type !== "add") { oldIndexes[index] = old.length; old.push(line.content); }
      if (line.type !== "remove") { newIndexes[index] = next.length; next.push(line.content); }
    });
    return { old: old.join("\n"), new: next.join("\n"), oldIndexes, newIndexes };
  }, [lines]);
  const words = useMemo(() => wordRanges(lines), [lines]);
  const anchor = useRef<{ side: "old" | "new"; line: number } | null>(null);
  const drag = useRef<{ side: "old" | "new"; line: number } | null>(null), suppressDragClick = useRef(false);
  const [localSelection, setLocalSelection] = useState<NativeDiffSelection | null>(null);
  const activeSelection = selection === undefined ? localSelection : selection;
  useEffect(() => { anchor.current = null; drag.current = null; suppressDragClick.current = false; setLocalSelection(null); }, [lines, path]);
  useEffect(() => { const finish = () => { drag.current = null; }; window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish); return () => { window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); }; }, []);
  const select = (side: "old" | "new", line: number, extend: boolean) => {
    if (!onSelectLines) return;
    const start = extend && anchor.current?.side === side ? anchor.current.line : line;
    const next = selectNativeDiffRange(lines, side, start, line);
    if (!next) return;
    if (!extend || anchor.current?.side !== side) anchor.current = { side, line };
    setLocalSelection(next);
    onSelectLines(next);
  };
  const splitRows = useMemo(() => split ? nativeSplitLines(lines) : [], [lines, split]);
  const viewport = useRef<HTMLDivElement>(null);
  const count = split ? splitRows.length : lines.length;
  const virtual = count > 1200;
  const virtualizer = useVirtualizer({ count: virtual ? count : 0, getScrollElement: () => viewport.current, estimateSize: () => 20, overscan: 12 });
  const hunkIndexes = useMemo(() => {
    let index = -1;
    return lines.map((line) => { if (line.separator) index++; return index; });
  }, [lines]);
  const hunkGaps = useMemo(() => {
    let previous = 0;
    return lines.map(line => {
      if (!line.separator) { previous = line.lineNumber.new ?? previous; return 0; }
      const start = Number(line.content.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)?.[1]);
      return Math.max(0, start - previous - 1);
    });
  }, [lines]);
  const hunkActionLines = useMemo(() => {
    const last = new Map<number, number>();
    lines.forEach((line, index) => { if (!line.separator && (line.type === "add" || line.type === "remove")) last.set(hunkIndexes[index], index); });
    return new Map([...last].map(([hunk, index]) => [index, hunk]));
  }, [lines, hunkIndexes]);
  useEffect(() => {
    let active = true;
    setHighlight({ old: null, new: null });
    const language = languages[
      path?.split(".").pop()?.toLowerCase() ?? ""
    ] as Parameters<typeof codexCode.supportsLanguage>[0];
    if (
      !language ||
      !codexCode.supportsLanguage(language) ||
      sources.old.length + sources.new.length > 200000
    )
      return;
    for (const side of ["old", "new"] as const) {
    const result = codexCode.highlight(
      { code: sources[side], language, themes: codexCode.getThemes() },
      (result) => {
        if (active) setHighlight(current => ({ ...current, [side]: result }));
      },
    );
    if (result) setHighlight(current => ({ ...current, [side]: result }));
    }
    return () => {
      active = false;
    };
  }, [sources, path]);
  const renderLine = (index: number, side?: "old" | "new", annotation = true) => {
    const line = lines[index];
    if (line.separator)
      if (!hunkHeaders)
        return index === 0 ? null : (
          <div key={index} className="codex-diff-gap" aria-hidden="true" />
        );
    if (line.separator)
      return (
        <div key={index} className={`codex-diff-hunk${hunkPresentation === "line-info" ? " codex-diff-line-info" : ""}`} data-hunk-index={hunkIndexes[index]}>
          <span>{hunkPresentation === "line-info" ? (hunkGaps[index] ? `${hunkGaps[index]} 行未展开的上下文` : "变更块") : line.content}</span>
        </div>
      );
    const ownSide = side ?? (line.type === "remove" ? "old" : "new");
    const number = line.lineNumber[ownSide];
    const selected = activeSelection?.side === ownSide && number !== undefined && number >= activeSelection.start && number <= activeSelection.end;
    const tokens = highlight[ownSide]?.tokens[(ownSide === "old" ? sources.oldIndexes : sources.newIndexes)[index]] ?? [
      { content: line.content, color: "inherit" },
    ];
    const changed = words.get(index) ?? [];
    let offset = 0;
    return (
      <div key={index} className="codex-diff-annotated-row">
      <div
        className="codex-diff-line"
        data-kind={line.type}
        data-old-line={side !== "new" ? line.lineNumber.old : undefined}
        data-new-line={side !== "old" ? line.lineNumber.new : undefined}
        data-selected={selected || undefined}
        onDoubleClick={number !== undefined && onOpenLine ? () => onOpenLine({ side: ownSide, line: number }) : undefined}
      >
        {onSelectLines && number !== undefined ? <button type="button" className="codex-diff-number codex-diff-select-line" aria-label={`选择${ownSide === "old" ? "旧" : "新"}文件第 ${number} 行`} aria-pressed={selected}
          onPointerDown={event => { if (event.button !== 0 || event.pointerType === "touch") return; drag.current = { side: ownSide, line: number }; suppressDragClick.current = false; select(ownSide, number, event.shiftKey); }}
          onPointerEnter={event => { if (!drag.current || drag.current.side !== ownSide || !(event.buttons & 1) || drag.current.line === number) return; suppressDragClick.current = true; select(ownSide, number, true); }}
          onClick={event => { if (suppressDragClick.current) { suppressDragClick.current = false; return; } select(ownSide, number, event.shiftKey); }}
          onKeyDown={event => { if (!event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const line = number + (event.key === "ArrowUp" ? -1 : 1); select(ownSide, line, true); viewport.current?.querySelector<HTMLButtonElement>(`button[aria-label="选择${ownSide === "old" ? "旧" : "新"}文件第 ${line} 行"]`)?.focus({ preventScroll: true }); }}
        ><span>{number}</span></button> : <span className="codex-diff-number"><span>
          {side === "old"
            ? line.lineNumber.old
            : (line.lineNumber.new ?? line.lineNumber.old)}
        </span></span>}
        <code className="codex-diff-source">
          {tokens.map((token, tokenIndex) => {
            const start = offset,
              end = start + token.content.length;
            offset = end;
            const boundaries = [
              ...new Set([
                start,
                end,
                ...changed
                  .flat()
                  .filter((point) => point > start && point < end),
              ]),
            ].sort((a, b) => a - b);
            const style = {
              color: token.color,
              ...("htmlStyle" in token ? token.htmlStyle : {}),
            } as CSSProperties;
            return boundaries.slice(0, -1).map((point, segment) => {
              const finish = boundaries[segment + 1];
              const changedWord = changed.some(
                ([from, to]) => point >= from && finish <= to,
              );
              return (
                <span
                  key={`${tokenIndex}-${segment}`}
                  className={`codex-diff-token${changedWord ? " codex-diff-word" : ""}`}
                  style={style}
                >
                  {token.content.slice(point - start, finish - start)}
                </span>
              );
            });
          })}
          {!line.content && " "}
        </code>
      </div>
      {renderHunkActions && hunkActionLines.has(index) && <div className="codex-diff-hunk-annotation" data-hunk-actions={hunkActionLines.get(index)}>{renderHunkActions(hunkActionLines.get(index)!)}</div>}
      {annotation && number !== undefined && renderAnnotation?.({ side: ownSide, line: number })}
      </div>
    );
  };
  const renderRow = (index: number) => split ? (() => {
    const row = splitRows[index];
    return (
        row.separator !== undefined ? (
          <div key={index} className="codex-diff-split-hunk">
            {renderLine(row.separator)}
          </div>
        ) : (
          <div key={index} className="codex-diff-split-group"><div className="codex-diff-split-row">
            <div data-diff-side="old">
              {row.left !== undefined ? (
                renderLine(row.left, "old", false)
              ) : (
                <div className="codex-diff-empty" />
              )}
            </div>
            <div data-diff-side="new">
              {row.right !== undefined ? (
                renderLine(row.right, "new", false)
              ) : (
                <div className="codex-diff-empty" />
              )}
            </div>
          </div>{renderAnnotation && <div className="codex-diff-split-annotations"><div>{row.left !== undefined && lines[row.left].lineNumber.old !== undefined && renderAnnotation({ side: "old", line: lines[row.left].lineNumber.old! })}</div><div>{row.right !== undefined && lines[row.right].lineNumber.new !== undefined && renderAnnotation({ side: "new", line: lines[row.right].lineNumber.new! })}</div></div>}</div>
        )
    );
  })() : renderLine(index);
  return <div ref={viewport} className={`codex-native-diff-content${split ? " codex-diff-split" : ""}${virtual ? " codex-diff-virtual" : ""}`} data-diff-split={split || undefined} data-diff-wrap={wrap || undefined} data-diff-virtual={virtual || undefined}>
    {virtual ? <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{virtualizer.getVirtualItems().map((row) => <div key={row.key} data-index={row.index} ref={virtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>{renderRow(row.index)}</div>)}</div> : Array.from({ length: count }, (_, index) => renderRow(index))}
  </div>;
}
