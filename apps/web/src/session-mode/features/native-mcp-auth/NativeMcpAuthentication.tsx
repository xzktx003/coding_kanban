import { useEffect } from "react";
import { startMcpAuthentication } from "./service";
export function NativeMcpAuthentication() {
  useEffect(() => startMcpAuthentication(), []);
  return null;
}
