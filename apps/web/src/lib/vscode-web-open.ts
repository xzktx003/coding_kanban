import type { OpenVsCodeWebResponse } from "@agent-orchestrator/shared";

const inflightOpenRequests = new Map<string, Promise<OpenVsCodeWebResponse>>();
const cachedOpenResponses = new Map<string, OpenVsCodeWebResponse>();
const MAX_CACHED_OPEN_RESPONSES = 16;

interface OpenVsCodeWebOnceOptions {
  allowCachedResponse?: boolean;
}

function cacheOpenResponse(
  agentSessionId: string,
  response: OpenVsCodeWebResponse,
): void {
  cachedOpenResponses.delete(agentSessionId);
  cachedOpenResponses.set(agentSessionId, response);

  while (cachedOpenResponses.size > MAX_CACHED_OPEN_RESPONSES) {
    const oldestSessionId = cachedOpenResponses.keys().next().value;
    if (typeof oldestSessionId !== "string") {
      break;
    }
    cachedOpenResponses.delete(oldestSessionId);
  }
}

export function openVsCodeWebOnce(
  agentSessionId: string,
  openSession: (agentSessionId: string) => Promise<OpenVsCodeWebResponse>,
  options: OpenVsCodeWebOnceOptions = {},
): Promise<OpenVsCodeWebResponse> {
  const existing = inflightOpenRequests.get(agentSessionId);
  if (existing) {
    return existing;
  }

  if (options.allowCachedResponse) {
    const cached = cachedOpenResponses.get(agentSessionId);
    if (cached) {
      return Promise.resolve(cached);
    }
  }

  const requestPromise = openSession(agentSessionId).finally(() => {
    if (inflightOpenRequests.get(agentSessionId) === requestPromise) {
      inflightOpenRequests.delete(agentSessionId);
    }
  });

  void requestPromise.then(
    (response) => cacheOpenResponse(agentSessionId, response),
    () => {},
  );

  inflightOpenRequests.set(agentSessionId, requestPromise);
  return requestPromise;
}

export function primeVsCodeWebOpenResponse(
  agentSessionId: string,
  response: OpenVsCodeWebResponse,
): void {
  cacheOpenResponse(agentSessionId, response);
}

export function clearInflightVsCodeWebRequests(): void {
  inflightOpenRequests.clear();
  cachedOpenResponses.clear();
}
