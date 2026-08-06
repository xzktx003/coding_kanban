export const VSCODE_HTTPS_CA_DOWNLOAD_PATH = "/__coding-kanban/https-ca.crt";
export const VSCODE_SERVICE_WORKER_PROBE_PATH =
  "/__coding-kanban/service-worker-probe.js";
const VSCODE_SERVICE_WORKER_PROBE_SCOPE =
  "/__coding-kanban/vscode-service-worker-probe/";

interface ProbeRegistration {
  unregister(): Promise<boolean>;
}

interface ProbeServiceWorkerContainer {
  register(
    scriptUrl: string,
    options: { scope: string },
  ): Promise<ProbeRegistration>;
}

interface VsCodeServiceWorkerProbeDependencies {
  isSecureContext: boolean;
  serviceWorker: ProbeServiceWorkerContainer | null;
}

export type VsCodeServiceWorkerProbeResult =
  | { state: "ready" }
  | {
      state: "blocked";
      reason:
        | "certificate"
        | "insecure-origin"
        | "registration"
        | "unsupported";
      detail: string;
    };

let cachedProbe: Promise<VsCodeServiceWorkerProbeResult> | null = null;

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyRegistrationFailure(
  error: unknown,
): VsCodeServiceWorkerProbeResult {
  const detail = errorDetail(error);
  const reason = /(?:ssl|certificate|cert(?:ificate)?[_ -]?error)/i.test(detail)
    ? "certificate"
    : "registration";

  return { state: "blocked", reason, detail };
}

export async function checkVsCodeWebServiceWorker(
  dependencies: VsCodeServiceWorkerProbeDependencies,
): Promise<VsCodeServiceWorkerProbeResult> {
  if (!dependencies.isSecureContext) {
    return {
      state: "blocked",
      reason: "insecure-origin",
      detail: "The current browser origin is not a secure context.",
    };
  }

  if (!dependencies.serviceWorker) {
    return {
      state: "blocked",
      reason: "unsupported",
      detail: "Service Workers are unavailable in this browser context.",
    };
  }

  try {
    const registration = await dependencies.serviceWorker.register(
      VSCODE_SERVICE_WORKER_PROBE_PATH,
      { scope: VSCODE_SERVICE_WORKER_PROBE_SCOPE },
    );
    await registration.unregister();
    return { state: "ready" };
  } catch (error) {
    return classifyRegistrationFailure(error);
  }
}

export function probeVsCodeWebServiceWorker(options?: {
  force?: boolean;
}): Promise<VsCodeServiceWorkerProbeResult> {
  if (!cachedProbe || options?.force) {
    cachedProbe = checkVsCodeWebServiceWorker({
      isSecureContext: window.isSecureContext,
      serviceWorker: navigator.serviceWorker ?? null,
    });
  }

  return cachedProbe;
}
