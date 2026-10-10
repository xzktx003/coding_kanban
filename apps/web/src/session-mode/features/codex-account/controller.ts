import type {
  GetAccountRateLimitsResponse,
  GetAccountResponse,
} from "@session/bindings/v2";
export interface CodexAccountUsageState {
  loading: boolean;
  response: GetAccountRateLimitsResponse | null;
  account: GetAccountResponse | null;
  error: string | null;
  updatedAt: number | null;
}
export interface CodexAccountUsageApi {
  readAccount: (signal: AbortSignal) => Promise<GetAccountResponse>;
  readRateLimits: (
    signal: AbortSignal,
  ) => Promise<GetAccountRateLimitsResponse>;
}
/** Read-only full snapshots preserve the meaning of nullable sparse updates.
 * Account changes clear former-account quotas before awaiting a replacement.
 */
export class CodexAccountUsageController {
  private state: CodexAccountUsageState = {
    loading: false,
    response: null,
    account: null,
    error: null,
    updatedAt: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private disposed = false;
  constructor(private readonly api: CodexAccountUsageApi) {}
  activate() {
    this.disposed = false;
  }
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(patch: Partial<CodexAccountUsageState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async refresh(accountChanged = false) {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    this.set({
      loading: true,
      ...(accountChanged
        ? { response: null, account: null, updatedAt: null }
        : {}),
    });
    const [account, rate] = await Promise.allSettled([
      this.api.readAccount(controller.signal),
      this.api.readRateLimits(controller.signal),
    ]);
    if (this.disposed || generation !== this.generation) return;
    this.set({
      loading: false,
      account: account.status === "fulfilled" ? account.value : null,
      response: rate.status === "fulfilled" ? rate.value : null,
      error:
        rate.status === "fulfilled"
          ? null
          : rate.reason instanceof Error
            ? rate.reason.message
            : String(rate.reason),
      updatedAt: rate.status === "fulfilled" ? Date.now() : null,
    });
  }
  notification(value: unknown) {
    if (!value || typeof value !== "object") return;
    const payload = value as {
      method?: string;
      params?: { success?: boolean };
    };
    if (
      payload.method === "account/updated" ||
      (payload.method === "account/login/completed" &&
        payload.params?.success === true)
    )
      void this.refresh(true);
    else if (payload.method === "account/rateLimits/updated")
      void this.refresh();
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.controller?.abort();
    this.listeners.clear();
  }
}
