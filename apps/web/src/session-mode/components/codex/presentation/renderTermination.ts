import type { TurnStatus } from "@session/bindings/v2";

/** Display certainty only; never written into native events or runtime state. */
export type RenderTermination = TurnStatus | "unverified";
