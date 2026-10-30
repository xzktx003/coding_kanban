export function webDevCacheInstanceId(): string;
export function webDevReactOptions(): { exclude: RegExp[] };

export function resolveWebDevCacheDir(options: {
  projectRoot: string;
  mode?: string;
  instanceId?: string;
}): string;
