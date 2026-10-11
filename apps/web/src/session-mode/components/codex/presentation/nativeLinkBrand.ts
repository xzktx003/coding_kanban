export type NativeLinkBrand =
  | "google-calendar"
  | "google-drive"
  | "figma"
  | "github"
  | "linear"
  | "gmail"
  | "notion"
  | "recruiting-assistant"
  | "salesforce"
  | "slack";
const brands: readonly [NativeLinkBrand, readonly string[]][] = [
  ["google-calendar", ["calendar.google.com"]],
  [
    "google-drive",
    [
      "docs.google.com",
      "drive.google.com",
      "sheets.google.com",
      "slides.google.com",
    ],
  ],
  ["figma", ["figma.com"]],
  ["github", ["github.com"]],
  ["linear", ["linear.app"]],
  ["gmail", ["mail.google.com"]],
  ["notion", ["app.notion.com", "notion.so"]],
  [
    "recruiting-assistant",
    [
      "recruiting.apps.openai.org",
      "recruiting.extapps.openai.org",
      "recruiting.extapps-staging.openai.org",
      "recruiting.staging-apps.openai.org",
    ],
  ],
  ["salesforce", ["force.com", "salesforce.com"]],
  ["slack", ["slack.com"]],
];
/** Native rLn/kln; recognized URLs without an icon still use the favicon fallback. */
export function nativeLinkBrand(href: string): NativeLinkBrand | null {
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return (
      brands.find(([, hosts]) =>
        hosts.some(
          (host) => url.hostname === host || url.hostname.endsWith("." + host),
        ),
      )?.[0] ?? null
    );
  } catch {
    return null;
  }
}
