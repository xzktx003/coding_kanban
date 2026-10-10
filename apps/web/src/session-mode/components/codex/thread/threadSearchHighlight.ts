/** Select visible message text without replacing Markdown nodes or including action labels. */
export function findTranscriptMatchRange(
  root: Element,
  query: string,
  occurrence = 0,
): Range | null {
  if (!query || !Number.isSafeInteger(occurrence) || occurrence < 0)
    return null;
  const body = root.querySelector(
    ".codex-assistant-content, .codex-user-bubble",
  );
  if (!body) return null;
  const nodes: Text[] = [],
    walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (
      node.parentElement?.closest(
        'button, summary, [hidden], [aria-hidden="true"], .sr-only, .session-message-actions',
      )
    )
      continue;
    nodes.push(node);
  }
  const original = nodes.map((node) => node.data).join(""),
    starts: number[] = [],
    ends: number[] = [];
  let text = "",
    offset = 0;
  for (const char of original) {
    const folded = char.toLocaleLowerCase();
    text += folded;
    for (let index = 0; index < folded.length; index++) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    offset += char.length;
  }
  const needle = query.toLocaleLowerCase();
  let from = 0,
    index = -1;
  for (let current = 0; current <= occurrence; current++) {
    index = text.indexOf(needle, from);
    if (index < 0) return null;
    from = index + needle.length;
  }
  const range = document.createRange();
  const startOffset = starts[index],
    endOffset = ends[index + needle.length - 1];
  let position = 0,
    started = false;
  for (const node of nodes) {
    const end = position + node.length;
    if (!started && startOffset < end) {
      range.setStart(node, startOffset - position);
      started = true;
    }
    if (started && endOffset <= end) {
      range.setEnd(node, endOffset - position);
      return range;
    }
    position = end;
  }
  return null;
}

// Multiple visible split panes can each own one highlight; cleanup removes only its owner's range.
const owners = new Map<Element, Range>();
export function setTranscriptSearchHighlight(
  owner: Element,
  range: Range | null,
): () => void {
  const registry = (
    globalThis.CSS as unknown as
      | {
          highlights?: {
            set: (key: string, value: unknown) => void;
            delete: (key: string) => void;
          };
        }
      | undefined
  )?.highlights;
  const Constructor = (
    globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  const update = () => {
    if (!registry || !Constructor) return;
    if (owners.size)
      registry.set(
        "codex-thread-search-active",
        new Constructor(...owners.values()),
      );
    else registry.delete("codex-thread-search-active");
  };
  if (range) owners.set(owner, range);
  else owners.delete(owner);
  update();
  return () => {
    if (owners.get(owner) === range) {
      owners.delete(owner);
      update();
    }
  };
}
