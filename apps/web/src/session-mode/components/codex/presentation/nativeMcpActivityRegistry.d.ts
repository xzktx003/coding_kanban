export interface NativeMcpDescriptor {
  descriptor: { id: string; defaultMessage: string };
  values: Record<string, unknown>;
}
export function nativeMcpActivityDescriptor(
  app: { id: string; name: string; pluginDisplayNames?: string[] },
  tool: string,
  args: unknown,
  result: unknown,
  completed: boolean,
): NativeMcpDescriptor | null;
