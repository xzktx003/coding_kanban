export function webDevCacheInstanceId(): string;

export function resolveWebDevCacheDir(options: {
  projectRoot: string;
  mode?: string;
  instanceId?: string;
}): string;
