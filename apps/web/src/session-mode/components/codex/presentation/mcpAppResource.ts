/** Public native resource identity only; HTML and tool results never enter this projection. */
export function hasMcpAppResource(item: {
  mcpAppResourceUri?: string;
  appContext?: { resourceUri?: string | null } | null;
}): boolean {
  const uri = item.appContext?.resourceUri || item.mcpAppResourceUri;
  return (
    typeof uri === "string" &&
    uri.startsWith("ui://") &&
    uri.length <= 4096 &&
    !/[\u0000-\u0020\u007f]/u.test(uri)
  );
}
