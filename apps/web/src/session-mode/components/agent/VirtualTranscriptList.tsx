import { observeElementOffset, useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import {
  getReadingPosition,
  saveReadingPosition,
  type ReadingPosition,
} from "@session/services/sessionTranscriptCache";
import { TranscriptRowState } from "./TranscriptRowState";

// The upstream observer removes its listeners but leaves its scroll-end
// debounce alive. A retired document must never dispatch that callback to React.
const observeTranscriptOffset: typeof observeElementOffset = (instance, notify) => {
  let active = true;
  const stop = observeElementOffset(instance, (offset, scrolling) => {
    if (active) notify(offset, scrolling);
  });
  return () => { active = false; stop?.(); };
};

interface Props<T> {
  owner: string;
  items: T[];
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  followingRef: RefObject<boolean>;
  onFollowingChange?: (following: boolean) => void;
}

/** Variable-height viewport for Claude/ACP; native history and approvals stay outside it. */
export function VirtualTranscriptList<T>({
  owner,
  items,
  getKey,
  renderRow,
  scrollRef,
  followingRef,
  onFollowingChange,
}: Props<T>) {
  const keys = useMemo(() => items.map(getKey), [items, getKey]);
  const virtual = items.length > 80;
  const reading = useRef<ReadingPosition | null>(null);
  const programmatic = useRef(false);
  const frame = useRef(0);
  const pin = useRef<() => void>(() => {});
  const expansion = useMemo(() => new Map<string, boolean>(), [owner]);
  const schedulePin = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      pin.current();
    });
  }, []);
  const rows = useVirtualizer({
    observeElementOffset: observeTranscriptOffset,
    count: virtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => `${owner}:${keys[index]}`,
    estimateSize: () => 120,
    overscan: 6,
    initialRect: { width: 800, height: 600 },
    onChange: (_instance, sync) => {
      if (!sync) schedulePin();
    },
  });
  rows.shouldAdjustScrollPositionOnItemSizeChange = (item) =>
    !followingRef.current && item.start < (scrollRef.current?.scrollTop ?? 0);
  pin.current = () => {
    const element = scrollRef.current;
    if (!element) return;
    programmatic.current = true;
    if (followingRef.current)
      element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
    else if (reading.current?.anchor) {
      const anchor = [
        ...element.querySelectorAll<HTMLElement>("[data-transcript-row]"),
      ].find((node) => node.dataset.transcriptRow === reading.current?.anchor);
      if (anchor)
        element.scrollTop +=
          anchor.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          reading.current.offset;
    }
    requestAnimationFrame(() => {
      programmatic.current = false;
    });
  };
  useLayoutEffect(() => {
    reading.current = getReadingPosition(owner) ?? null;
    followingRef.current = reading.current?.atBottom ?? true;
    rows.measure();
    if (virtual && items.length) {
      const anchor = keys.indexOf(reading.current?.anchor ?? "");
      rows.scrollToIndex(
        followingRef.current ? items.length - 1 : Math.max(0, anchor),
        { align: followingRef.current ? "end" : "start" },
      );
    } else if (scrollRef.current && !followingRef.current)
      scrollRef.current.scrollTop = reading.current?.scrollTop ?? 0;
    pin.current();
    schedulePin();
    // Owner changes reset layout; subsequent data/measurement updates preserve its anchor.
  }, [owner]);
  useLayoutEffect(() => {
    if (followingRef.current && virtual && items.length)
      rows.scrollToIndex(items.length - 1, { align: "end" });
    pin.current();
    schedulePin();
  }, [items, virtual, schedulePin]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const read = () => {
      if (programmatic.current || (frame.current && followingRef.current))
        return;
      const atBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight <= 4;
      // Virtualizer measurement and ancestor layout can emit scroll events
      // after our animation frame. Only an explicit reading gesture leaves
      // latest-following mode; a shrinking estimate must not pin us at row 0.
      if (followingRef.current && !atBottom) {
        schedulePin();
        return;
      }
      followingRef.current = atBottom;
      const anchor = [
        ...element.querySelectorAll<HTMLElement>("[data-transcript-row]"),
      ].find(
        (node) =>
          node.getBoundingClientRect().bottom >
          element.getBoundingClientRect().top,
      );
      reading.current = {
        atBottom,
        anchor: anchor?.dataset.transcriptRow,
        offset: anchor
          ? element.getBoundingClientRect().top -
            anchor.getBoundingClientRect().top
          : 0,
        scrollTop: element.scrollTop,
      };
      saveReadingPosition(owner, reading.current);
      onFollowingChange?.(atBottom);
    };
    const intent = () => {
      programmatic.current = false;
      followingRef.current = false;
      reading.current = null;
    };
    const keyboardIntent = (event: KeyboardEvent) => {
      if (
        [
          "PageUp",
          "PageDown",
          "Home",
          "End",
          "ArrowUp",
          "ArrowDown",
          " ",
        ].includes(event.key) &&
        !(event.target as Element)?.closest("input,textarea,[contenteditable]")
      )
        intent();
    };
    const scrollbarIntent = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (
        event.target === element &&
        event.clientX >=
          rect.right - Math.max(16, element.offsetWidth - element.clientWidth)
      )
        intent();
    };
    element.addEventListener("scroll", read, { passive: true });
    element.addEventListener("wheel", intent, { passive: true });
    element.addEventListener("touchmove", intent, { passive: true });
    element.addEventListener("pointerdown", scrollbarIntent, { passive: true });
    element.addEventListener("keydown", keyboardIntent);
    return () => {
      element.removeEventListener("scroll", read);
      element.removeEventListener("wheel", intent);
      element.removeEventListener("touchmove", intent);
      element.removeEventListener("pointerdown", scrollbarIntent);
      element.removeEventListener("keydown", keyboardIntent);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [owner, scrollRef, followingRef, onFollowingChange, schedulePin]);
  useEffect(() => {
    const live = new Set(keys);
    for (const key of expansion.keys())
      if (!live.has(JSON.parse(key)[0])) expansion.delete(key);
  }, [keys, expansion]);

  const visible = virtual
    ? rows.getVirtualItems()
    : items.map((_, index) => ({ index, key: keys[index], start: 0 }));
  return (
    <div
      data-virtual-transcript={owner}
      style={
        virtual
          ? {
              height: rows.getTotalSize(),
              position: "relative",
              overflowAnchor: "none",
            }
          : undefined
      }
    >
      {visible.map((row) => (
        <div
          key={`${owner}:${keys[row.index]}`}
          data-index={row.index}
          data-transcript-row={keys[row.index]}
          ref={virtual ? rows.measureElement : undefined}
          style={{
            ...(virtual
              ? ({
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                } as const)
              : {}),
            paddingBottom: 8,
          }}
        >
          <TranscriptRowState row={keys[row.index]} values={expansion}>
            {renderRow(items[row.index], row.index)}
          </TranscriptRowState>
        </div>
      ))}
    </div>
  );
}
