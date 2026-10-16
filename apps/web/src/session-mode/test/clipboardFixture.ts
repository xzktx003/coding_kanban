import { vi } from "vitest";

/** Only fake navigator/document state; never touches the host clipboard. */
export function clipboardFixture() {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const command = Object.getOwnPropertyDescriptor(document, "execCommand");
  const texts: string[] = [];
  const copyEvents: Array<{ data: Record<string, string>; defaultPrevented: boolean; activeTag: string }> = [];
  const legacy = vi.fn(() => {
    // Modal focus scopes may restore focus during textarea.focus(). Inspect
    // the transport's actual temporary value, not an assumed activeElement.
    const temporary = document.querySelector<HTMLTextAreaElement>('textarea[style*="-9999px"]');
    texts.push(temporary?.value ?? "");
    const data: Record<string, string> = {};
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (type: string, value: string) => { data[type] = value; } },
    });
    const activeTag = document.activeElement?.tagName ?? "";
    (document.activeElement ?? document).dispatchEvent(event);
    copyEvents.push({ data, defaultPrevented: event.defaultPrevented, activeTag });
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: legacy });
  const modern = (writeText?: (text: string) => Promise<void>) =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    });
  modern();
  return {
    texts,
    copyEvents,
    legacy,
    modern,
    restore() {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
      if (command) Object.defineProperty(document, "execCommand", command);
      else Reflect.deleteProperty(document, "execCommand");
    },
  };
}

export function deferredClipboard() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Keep the old unhandled implementation from crashing unrelated red cases.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
