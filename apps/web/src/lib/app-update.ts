const ACCEPTED_REVISION_KEY = "coding-kanban-accepted-revision-v1";
const DISMISSED_REVISION_KEY = "coding-kanban-dismissed-revision-v1";
const RESTORE_AFTER_RELOAD_KEY = "coding-kanban-restore-after-reload-v1";
const CONFIRMED_PULL_BASELINE_KEY =
  "coding-kanban-confirmed-pull-baseline-v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readAcceptedAppRevision(storage: StorageLike): string | null {
  try {
    const value = storage.getItem(ACCEPTED_REVISION_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function shouldOfferAppUpdate(
  acceptedRevision: string | null,
  currentRevision: string,
  dismissedRevision: string | null = null,
): boolean {
  return Boolean(
    acceptedRevision &&
    acceptedRevision !== currentRevision &&
    dismissedRevision !== currentRevision,
  );
}

export function readDismissedAppRevision(storage: StorageLike): string | null {
  try {
    const value = storage.getItem(DISMISSED_REVISION_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function dismissAppRevision(
  storage: StorageLike,
  revision: string,
): void {
  try {
    storage.setItem(DISMISSED_REVISION_KEY, revision);
  } catch {
    // The in-memory caller state still keeps this revision dismissed.
  }
}

export function initializeAcceptedAppRevision(
  storage: StorageLike,
  revision: string,
): string {
  const existing = readAcceptedAppRevision(storage);
  if (existing) {
    return existing;
  }

  try {
    storage.setItem(ACCEPTED_REVISION_KEY, revision);
  } catch {
    // The in-memory caller state still establishes the baseline.
  }
  return revision;
}

export function acceptAppRevision(
  storage: StorageLike,
  revision: string,
): void {
  try {
    storage.setItem(ACCEPTED_REVISION_KEY, revision);
    storage.setItem(RESTORE_AFTER_RELOAD_KEY, "1");
  } catch {
    // Reload still works even when browser storage is unavailable.
  }
}

export function beginConfirmedAppPull(
  storage: StorageLike,
  baselineRevision: string,
): void {
  try {
    storage.setItem(CONFIRMED_PULL_BASELINE_KEY, baselineRevision);
  } catch {
    // The in-memory caller still tracks the confirmed pull.
  }
}

export function readConfirmedAppPullBaseline(
  storage: StorageLike,
): string | null {
  try {
    const value = storage.getItem(CONFIRMED_PULL_BASELINE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function clearConfirmedAppPull(storage: StorageLike): void {
  try {
    storage.removeItem(CONFIRMED_PULL_BASELINE_KEY);
  } catch {
    // The in-memory caller still clears the confirmed pull.
  }
}

export function consumeRestoreAfterReload(storage: StorageLike): boolean {
  try {
    const shouldRestore = storage.getItem(RESTORE_AFTER_RELOAD_KEY) === "1";
    storage.removeItem(RESTORE_AFTER_RELOAD_KEY);
    return shouldRestore;
  } catch {
    return false;
  }
}
