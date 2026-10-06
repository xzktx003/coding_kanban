export function sessionPortalContainer(): HTMLElement | undefined {
  return typeof document === "undefined"
    ? undefined
    : (document.querySelector<HTMLElement>(".session-mode") ?? undefined);
}

export function isSessionModeActive(): boolean {
  const root = sessionPortalContainer();
  return Boolean(root && !root.hidden);
}

export function listenInSessionMode(
  target: Window | Document,
  type: string,
  listener: (event: KeyboardEvent) => void,
  options?: boolean | AddEventListenerOptions,
): () => void {
  const scoped = (event: Event) => {
    if (isSessionModeActive()) listener(event as KeyboardEvent);
  };
  target.addEventListener(type, scoped, options);
  return () => target.removeEventListener(type, scoped, options);
}
