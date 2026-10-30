import {
  isEventStreamConnected,
  openEventStream,
} from "../src/session-mode/lib/eventStream";

interface EventStreamOfflineFixture {
  state: {
    pendingApprovals: unknown[];
    receivedSeq: number[];
    receivedEvents: string[];
  };
  isConnected: typeof isEventStreamConnected;
  stop: () => void;
}

declare global {
  interface Window {
    __eventStreamBase: string;
    __eventStreamOfflineFixture?: EventStreamOfflineFixture;
  }
}

const state: EventStreamOfflineFixture["state"] = {
  pendingApprovals: [],
  receivedSeq: [],
  receivedEvents: [],
};
const stop = openEventStream({
  onEvent(event) {
    state.receivedSeq.push(event.seq);
    state.receivedEvents.push(event.event);
    if (event.event === "codex/pending-requests-snapshot") {
      const payload = event.payload as { requests?: unknown[] };
      state.pendingApprovals = payload.requests ?? [];
    }
  },
});

window.__eventStreamOfflineFixture = {
  state,
  isConnected: isEventStreamConnected,
  stop,
};
