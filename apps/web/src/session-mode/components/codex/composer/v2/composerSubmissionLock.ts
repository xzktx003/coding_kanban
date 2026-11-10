type SubmissionLocks = { owners: Set<string> };

// Keep outstanding locks when this module is hot-replaced during a send.
const hotData = import.meta.hot?.data;
const locks: SubmissionLocks = hotData?.composerSubmissionLocks ?? {
  owners: new Set<string>(),
};
if (hotData) hotData.composerSubmissionLocks = locks;

/** Serialize submissions from all composer surfaces for the same draft. */
export function acquireComposerSubmission(owner: string): (() => void) | null {
  if (locks.owners.has(owner)) return null;
  locks.owners.add(owner);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks.owners.delete(owner);
  };
}
