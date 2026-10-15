/** Local image syntax is preserved before Markdown's web-URL hardening. */
export function isLocalChatImage(source: string): boolean {
  const value = source.trim();
  return (
    /^file:/i.test(value) ||
    (!!value &&
      !value.startsWith("//") &&
      !/^[a-z][a-z\d+.-]*:/i.test(value) &&
      !value.startsWith("#"))
  );
}

export function resolveChatImageSource(
  source: string,
  root: string | null | undefined,
): string {
  if (!root?.startsWith("/")) throw new Error("原会话项目目录不可用");
  let value = source.trim();
  if (/^file:/i.test(value)) {
    const url = new URL(value);
    if (url.hostname && url.hostname !== "localhost")
      throw new Error("不支持远程 file 图片地址");
    value = url.pathname;
  }
  value = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  if (
    !value ||
    /[\0\r\n\\]/.test(value) ||
    value.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  )
    throw new Error("无效的本地图片路径");
  const normalize = (path: string) => {
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return "/" + parts.join("/");
  };
  const boundary = normalize(root);
  const path = normalize(
    value.startsWith("/") ? value : `${boundary}/${value}`,
  );
  if (boundary !== "/" && path !== boundary && !path.startsWith(boundary + "/"))
    throw new Error("图片不属于原会话项目");
  // The server independently checks the canonical path, including symlinks.
  return path;
}
