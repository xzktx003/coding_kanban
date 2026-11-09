import type * as fs from "node:fs/promises";

export interface DesktopPublishedProfile {
  version: 1;
  id: string;
  generation: string;
  pid: number;
  startTicks: string;
  uid: number;
  macAsarPath: string;
  macAsarSha256: string;
  linuxAsarPath: string;
  linuxAsarSha256: string;
  controlSocketPath: string;
  /** Optional fixed native-client endpoint, published only by an enabled new host. Never public HTTP input. */
  serverSshSocketPath?: string;
}

export interface ProfilePublisher {
  readonly published: boolean;
  readonly mayHavePublished: boolean;
  publish(): Promise<void>;
  verify(): Promise<boolean>;
  revoke(): Promise<void>;
}

/** Dependencies are injected by trusted server code, never by HTTP/JSON. */
export interface ProfilePublisherDependencies {
  beforeLink?: () => boolean | Promise<boolean>;
  fs?: Partial<Pick<typeof fs, "open" | "link" | "lstat" | "realpath">>;
}

export function createProfilePublisher(
  options: { profileFile: string; profile: DesktopPublishedProfile },
  dependencies?: ProfilePublisherDependencies,
): ProfilePublisher;
