import { useEffect, useRef } from 'react';
import { unwatchDirectory, watchDirectory } from '@session/services/apiAdapt/filesystem';

export type FsChangeEvent = {
  path: string;
  kind: string;
  is_dir?: boolean;
};

/**
 * Shared low-level hook for watching a directory via the Rust fs watcher
 * (notify + debouncer) and subscribing to its `fs_change` events.
 *
 * The Rust-side watcher is ref-counted per path, so multiple independent
 * callers can watch the same directory safely. This hook only owns:
 *   - starting/stopping the watch for `path`
 *   - subscribing/unsubscribing to `fs_change` events
 *
 * Filtering, debouncing, and refresh logic stays in the consuming hook
 * (e.g. useGitWatch, useFileTree) to keep concerns separated.
 */
export function useDirWatch(
  path: string | null,
  onChange: (event: FsChangeEvent) => void,
  enabled = true
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!path || !enabled) return;

    let cancelled = false;
    let watched = false;
    const onWsEvent = (event: Event) => {
      const detail = (event as CustomEvent<FsChangeEvent>).detail;
      if (!cancelled && detail) onChangeRef.current(detail);
    };
    window.addEventListener('fs_change', onWsEvent);
    void watchDirectory(path).then(() => {
      if (cancelled) void unwatchDirectory(path).catch(() => {});
      else watched = true;
    }).catch(() => { /* Manual refresh remains available. */ });
    return () => {
      cancelled = true;
      window.removeEventListener('fs_change', onWsEvent);
      if (watched) void unwatchDirectory(path).catch(() => {});
    };
  }, [path, enabled]);
}
