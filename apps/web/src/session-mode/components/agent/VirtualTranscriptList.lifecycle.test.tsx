import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VirtualTranscriptList } from "./VirtualTranscriptList";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("does not notify React from a delayed scroll-end callback after its document unmounts", () => {
  vi.useFakeTimers();
  const scrollRef = createRef<HTMLDivElement>();
  const followingRef = { current: true };
  const view = render(<div ref={scrollRef}><VirtualTranscriptList owner="lifecycle-test" items={Array.from({length: 100}, (_, i) => String(i))} getKey={(item) => item} renderRow={(item) => item} scrollRef={scrollRef} followingRef={followingRef} /></div>);
  fireEvent.scroll(scrollRef.current!, { target: { scrollTop: 300 } });
  view.unmount();
  vi.stubGlobal("window", undefined);
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
});
