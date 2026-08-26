export interface TerminalPaneLoadPermit {
  release(): void;
}

export interface TerminalPaneLoadRequest {
  cancel(): void;
  updatePriority(priority: number): void;
}

interface PendingTerminalPaneLoad {
  cancelled: boolean;
  granted: boolean;
  onGranted: (permit: TerminalPaneLoadPermit) => void;
  permit: TerminalPaneLoadPermit | null;
  priority: number;
  sequence: number;
}

export interface TerminalPaneLoadScheduler {
  request(
    priority: number,
    onGranted: (permit: TerminalPaneLoadPermit) => void,
  ): TerminalPaneLoadRequest;
}

export function createTerminalPaneLoadScheduler(
  maximumConcurrentLoads: number,
): TerminalPaneLoadScheduler {
  const concurrency = Math.max(1, Math.floor(maximumConcurrentLoads));
  const pending: PendingTerminalPaneLoad[] = [];
  let activeLoads = 0;
  let nextSequence = 0;
  let pumpScheduled = false;

  const schedulePump = () => {
    if (pumpScheduled) {
      return;
    }

    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pending.sort(
        (left, right) =>
          right.priority - left.priority || left.sequence - right.sequence,
      );

      while (activeLoads < concurrency && pending.length > 0) {
        const request = pending.shift()!;
        if (request.cancelled) {
          continue;
        }

        request.granted = true;
        activeLoads += 1;
        let released = false;
        const permit: TerminalPaneLoadPermit = {
          release() {
            if (released) {
              return;
            }

            released = true;
            activeLoads = Math.max(0, activeLoads - 1);
            schedulePump();
          },
        };
        request.permit = permit;
        request.onGranted(permit);
      }
    });
  };

  return {
    request(priority, onGranted) {
      const pendingRequest: PendingTerminalPaneLoad = {
        cancelled: false,
        granted: false,
        onGranted,
        permit: null,
        priority,
        sequence: nextSequence,
      };
      nextSequence += 1;
      pending.push(pendingRequest);
      schedulePump();

      return {
        cancel() {
          if (pendingRequest.cancelled) {
            return;
          }

          pendingRequest.cancelled = true;
          pendingRequest.permit?.release();
          schedulePump();
        },
        updatePriority(nextPriority) {
          if (pendingRequest.cancelled || pendingRequest.granted) {
            return;
          }

          pendingRequest.priority = nextPriority;
          schedulePump();
        },
      };
    },
  };
}

export const focusTerminalPaneLoadScheduler =
  createTerminalPaneLoadScheduler(2);
