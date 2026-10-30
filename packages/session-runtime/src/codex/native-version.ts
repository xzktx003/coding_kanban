/** Read the native initialize response, never the requesting client's version or an installed package. */
export function nativeVersionFromUserAgent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[A-Za-z][A-Za-z0-9 _.-]{0,127}\/([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(
    value,
  )?.[1];
}

// Each entry requires actual private native offer/SDP/text/stop and browser evidence.
const verifiedRealtimeWebRtcVersions = new Set(["0.163.0", "0.165.0"]);
export function nativeRealtimeWebRtcSupported(version: unknown): boolean {
  return (
    typeof version === "string" && verifiedRealtimeWebRtcVersions.has(version)
  );
}
