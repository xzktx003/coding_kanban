export interface QuickLink {
  title: string;
  url: string;
}
/** One-time migration source for links saved by the previous browser-only release. */
export const LEGACY_QUICK_LINKS_KEY = "kanban:terminal:quick-links:v1";
export async function readQuickLinks(): Promise<QuickLink[]> {
  const response = await fetch("/api/session/terminal-quick-links", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取快捷链接");
  return parseQuickLinks(JSON.stringify(await response.json()));
}
export async function writeQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  const response = await fetch("/api/session/terminal-quick-links", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(links),
  });
  if (!response.ok) throw new Error("无法保存快捷链接");
  return parseQuickLinks(JSON.stringify(await response.json()));
}
export function createQuickLink(title: string, address: string): QuickLink {
  const url = new URL(address.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 2048
  ) {
    throw new Error("请输入不含账号密码的 HTTP 或 HTTPS 链接");
  }
  const name = title.trim() || url.host;
  if (name.length > 80) throw new Error("链接名称最多 80 个字符");
  return { title: name, url: url.href };
}
export function parseQuickLinks(raw: string | null): QuickLink[] {
  try {
    if (!raw || raw.length > 100000) return [];
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items) || items.length > 40) return [];
    return items.flatMap((item) => {
      try {
        return [createQuickLink(item.title, item.url)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
