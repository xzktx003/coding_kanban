export const MAX_OSC52_CLIPBOARD_BASE64_LENGTH = 2 * 1024 * 1024;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64Bytes(value: string): Uint8Array | null {
  if (!BASE64_PATTERN.test(value) || value.length % 4 === 1) {
    return null;
  }

  try {
    const padded = value.padEnd(
      value.length + ((4 - (value.length % 4)) % 4),
      "=",
    );
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function decodeOsc52ClipboardPayload(data: string): string | null {
  const separatorIndex = data.indexOf(";");
  if (separatorIndex < 0) {
    return null;
  }

  const target = data.slice(0, separatorIndex);
  if (target !== "" && target !== "c") {
    return null;
  }

  const encoded = data.slice(separatorIndex + 1);
  if (
    !encoded ||
    encoded === "?" ||
    encoded.length > MAX_OSC52_CLIPBOARD_BASE64_LENGTH
  ) {
    return null;
  }

  const bytes = decodeBase64Bytes(encoded);
  if (!bytes) {
    return null;
  }

  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
