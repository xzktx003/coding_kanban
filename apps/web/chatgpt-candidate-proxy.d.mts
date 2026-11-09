import type { ServerOptions, UserConfig } from "vite";

export interface ChatGptCandidateLegacyRoute {
  readonly profileId: string;
  readonly generation: string;
  readonly loopbackPort: number;
}

/** Parse bounded, server-private JSON; absent/empty configuration disables legacy routes. */
export function parseChatGptCandidateLegacyRoutes(raw?: string): readonly ChatGptCandidateLegacyRoute[];

/** Fixed loopback routes and the standalone candidate server policy. */
export function configureChatGptCandidate<
  T extends UserConfig & { server: ServerOptions },
>(base: T, port: number, legacyRoutes?: readonly ChatGptCandidateLegacyRoute[]): Omit<T, "plugins" | "server"> & {
  plugins: NonNullable<UserConfig["plugins"]>;
  server: Omit<T["server"], "host" | "strictPort" | "proxy"> & {
    host: "0.0.0.0";
    strictPort: true;
    proxy: NonNullable<ServerOptions["proxy"]>;
  };
};
