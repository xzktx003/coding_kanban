import { create } from "zustand";
import type { captureHistorySourceScope } from "../components/history/historySourceScope";
type SourceScope = ReturnType<typeof captureHistorySourceScope>;
export interface ProviderHistorySourceIdentity {
  provider: "cc" | "acp";
  sourceId: string;
  itemId: string;
  owner: string;
}
export interface ProviderHistorySourceConfirmation extends ProviderHistorySourceIdentity {
  scope: SourceScope;
  confirmationKey: number;
  // Opaque locator for the page that actually confirmed this row. It grants no
  // authority: re-reading it must still capture and validate a fresh scope.
  readCursor?: string;
}
// Row identity is only a lookup. Only an actual accepted read can populate this
// map. Weak keys release the auth scope with the canonical row, without disk or
// body copies; HMR deliberately requires readonly confirmation again.
let confirmations = new WeakMap<object, ProviderHistorySourceConfirmation>();
let nextKey = 0;
export const useProviderHistoryConfirmationStore = create<{ revision: number }>(
  () => ({ revision: 0 }),
);
function sameScope(a: SourceScope, b: SourceScope) {
  return (
    a.path === b.path &&
    a.url === b.url &&
    a.headers.Authorization === b.headers.Authorization &&
    a.operation.revision === b.operation.revision &&
    a.operation.accountNamespace === b.operation.accountNamespace &&
    a.operation.hasAccount === b.operation.hasAccount &&
    a.operation.accountType === b.operation.accountType
  );
}
function sameIdentity(
  a: ProviderHistorySourceIdentity,
  b: ProviderHistorySourceIdentity,
) {
  return (
    a.provider === b.provider &&
    a.sourceId === b.sourceId &&
    a.itemId === b.itemId &&
    a.owner === b.owner
  );
}
export function confirmProviderHistoryRows(
  rows: ReadonlyArray<ProviderHistorySourceIdentity & { row: object }>,
  scope: SourceScope,
  readCursor?: string,
) {
  let changed = false;
  for (const { row, ...identity } of rows) {
    if (!row || !identity.sourceId || !identity.itemId || !identity.owner)
      continue;
    const previous = confirmations.get(row);
    if (
      previous &&
      sameIdentity(previous, identity) &&
      sameScope(previous.scope, scope)
    ) {
      previous.readCursor = readCursor;
      continue;
    }
    confirmations.set(row, {
      ...identity,
      scope,
      confirmationKey: ++nextKey,
      readCursor,
    });
    changed = true;
  }
  if (changed)
    useProviderHistoryConfirmationStore.setState((state) => ({
      revision: state.revision + 1,
    }));
}
export function readProviderHistoryConfirmation(
  row: object,
  identity: ProviderHistorySourceIdentity,
): ProviderHistorySourceConfirmation | null {
  const proof = confirmations.get(row);
  return proof && sameIdentity(proof, identity) ? proof : null;
}
import.meta.hot?.dispose(() => {
  confirmations = new WeakMap();
  useProviderHistoryConfirmationStore.setState((state) => ({
    revision: state.revision + 1,
  }));
});
