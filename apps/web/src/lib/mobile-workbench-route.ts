export interface MobileWorkbenchLocation {
  hash: string;
  pathname: string;
  search: string;
}

export type MobileWorkbenchLayout = "wide" | "narrow";

export function readMobileWorkbenchLayout(
  location: Pick<MobileWorkbenchLocation, "search">,
): MobileWorkbenchLayout | null {
  const layout = new URLSearchParams(location.search).get("layout");
  return layout === "wide" || layout === "narrow" ? layout : null;
}

export function mobileWorkbenchLayoutUrl(
  location: Pick<MobileWorkbenchLocation, "pathname" | "search" | "hash">,
  layout: MobileWorkbenchLayout,
): string {
  const url = new URL(
    `${location.pathname}${location.search}${location.hash}`,
    "http://workbench.local",
  );
  url.searchParams.set("view", "mobile");
  url.searchParams.set("layout", layout);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isMobileWorkbenchLocation({
  hash,
  pathname,
  search,
}: MobileWorkbenchLocation): boolean {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath === "/mobile" || normalizedPath === "/m") {
    return true;
  }

  const params = new URLSearchParams(search);
  if (params.get("view") === "mobile" || params.get("mobile") === "1") {
    return true;
  }

  const normalizedHash = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  return normalizedHash === "mobile" || normalizedHash === "m";
}
