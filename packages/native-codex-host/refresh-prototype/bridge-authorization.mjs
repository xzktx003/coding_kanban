// A separate initialized native observer; official request IDs and traffic are untouched.
import { validateNativeScope } from "./native-scope.mjs";
import {
  createNativeAuthorizationTracker,
  validateAuthorizationBinding,
} from "./authorization-boundary.mjs";

export function validateControlScope(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "generation,pid,startTicks" ||
    typeof value.generation !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value.generation,
    ) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 1 ||
    typeof value.startTicks !== "string" ||
    !/^[1-9][0-9]{0,29}$/.test(value.startTicks)
  )
    throw Error("exact refresh control identity required");
  return Object.freeze({
    generation: value.generation,
    pid: value.pid,
    startTicks: value.startTicks,
  });
}
export async function createBridgeAuthorization({
  service,
  control,
  signal,
  timeoutMs = 15000,
}) {
  const scope = validateNativeScope({
    domain: service?.record?.domain,
    generation: service?.record?.generation,
    pid: service?.record?.pid,
    startTicks: service?.record?.startTicks,
  });
  const expected = validateNativeScope(control?.serviceScope);
  if (
    ["domain", "generation", "pid", "startTicks"].some(
      (key) => scope[key] !== expected[key],
    ) ||
    typeof service?.connect !== "function" ||
    typeof service?.confirmAuthorization !== "function" ||
    typeof control?.authorization !== "function" ||
    typeof control.closed?.then !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000
  )
    throw Error("native authorization control scope unavailable");
  let valid = true,
    admitted = false,
    client,
    closing;
  const controller = new AbortController();
  const assertValid = () => {
    if (!valid) throw Error("bridge authorization unavailable");
  };
  const closeOwn = () => {
    if (!client) return Promise.resolve();
    return (closing ??= Promise.resolve().then(() => client.close()));
  };
  const invalidate = () => {
    if (!valid) return;
    valid = false;
    admitted = false;
    tracker.invalidate();
    controller.abort();
    void closeOwn().catch(() => {});
  };
  const tracker = createNativeAuthorizationTracker({
    ...scope,
    onInvalidated: invalidate,
  });
  signal?.addEventListener("abort", invalidate, { once: true });
  const close = async () => {
    invalidate();
    signal?.removeEventListener("abort", invalidate);
    await closeOwn();
  };
  control.closed.then(invalidate, invalidate);
  try {
    if (signal?.aborted) invalidate();
    assertValid();
    const before = validateAuthorizationBinding(await control.authorization());
    assertValid();
    client = await service.connect({
      name: "kanban_refresh_bridge_auth",
      timeoutMs,
      signal,
      onLifecycle: (event) => tracker.observe(event),
    });
    assertValid();
    if (typeof client.closed?.then !== "function")
      throw Error("native authorization observer unavailable");
    if (typeof client.assertAuthorizationCurrent !== "function")
      throw Error("native authority guard unavailable");
    client.closed.then(invalidate, invalidate);
    const actual = await tracker.bind(client, { timeoutMs });
    assertValid();
    await service.confirmAuthorization(actual);
    assertValid();
    tracker.assertValid();
    const after = validateAuthorizationBinding(await control.authorization());
    assertValid();
    if (
      before.kind !== actual.kind ||
      after.kind !== actual.kind ||
      before.fingerprint !== actual.fingerprint ||
      after.fingerprint !== actual.fingerprint
    )
      throw Error("bridge authorization changed during binding");
    admitted = true;
    return {
      signal: controller.signal,
      assertCurrent() {
        assertValid();
        tracker.binding();
        if (!admitted) throw Error("bridge authorization unavailable");
        try {
          client.assertAuthorizationCurrent();
        } catch {
          invalidate();
          throw Error("bridge authorization unavailable");
        }
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
