function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function parseHeaderUrl(
  value: string | string[] | undefined,
): { host: string; protocol: "http" | "https" } | null {
  const rawValue = firstForwardedValue(firstHeaderValue(value));
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    return {
      host: parsed.host,
      protocol: parsed.protocol === "https:" ? "https" : "http",
    };
  } catch {
    return null;
  }
}

export function resolveVsCodeWebRequestTarget(request: {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
}): { requestHost?: string; requestProtocol: "http" | "https" } {
  const forwardedProto = firstForwardedValue(
    firstHeaderValue(request.headers["x-forwarded-proto"]),
  );
  const detectedProtocol =
    forwardedProto === "https" ? "https" : detectProtocolFromHeaders(request);

  const forwardedHost = firstForwardedValue(
    firstHeaderValue(request.headers["x-forwarded-host"]),
  );
  if (forwardedHost) {
    return {
      requestHost: forwardedHost,
      requestProtocol: detectedProtocol,
    };
  }

  const browserOrigin =
    parseHeaderUrl(request.headers.origin) ??
    parseHeaderUrl(request.headers.referer);
  if (browserOrigin) {
    return {
      requestHost: browserOrigin.host,
      requestProtocol: browserOrigin.protocol,
    };
  }

  return {
    requestHost: firstForwardedValue(firstHeaderValue(request.headers.host)),
    requestProtocol: detectedProtocol,
  };
}

function detectProtocolFromHeaders(request: {
  headers: Record<string, string | string[] | undefined>;
}): "http" | "https" {
  const origin = firstHeaderValue(request.headers.origin);
  if (origin?.startsWith("https:")) {
    return "https";
  }

  const referer = firstHeaderValue(request.headers.referer);
  if (referer?.startsWith("https:")) {
    return "https";
  }

  return "http";
}
