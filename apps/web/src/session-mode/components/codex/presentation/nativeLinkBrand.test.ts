import { expect, it } from "vitest";
import { nativeLinkBrand } from "./nativeLinkBrand";
it.each([
  ["calendar.google.com", "google-calendar"],
  ["docs.google.com", "google-drive"],
  ["drive.google.com", "google-drive"],
  ["sheets.google.com", "google-drive"],
  ["slides.google.com", "google-drive"],
  ["figma.com", "figma"],
  ["github.com", "github"],
  ["linear.app", "linear"],
  ["mail.google.com", "gmail"],
  ["app.notion.com", "notion"],
  ["notion.so", "notion"],
  ["recruiting.apps.openai.org", "recruiting-assistant"],
  ["recruiting.extapps-staging.openai.org", "recruiting-assistant"],
  ["force.com", "salesforce"],
  ["salesforce.com", "salesforce"],
  ["api.slack.com", "slack"],
])("matches native registry and subdomains %s", (host, brand) => {
  expect(nativeLinkBrand(`https://${host}/x`)).toBe(brand);
  expect(nativeLinkBrand(`http://child.${host}/x`)).toBe(brand);
  expect(nativeLinkBrand(`https://${host}.evil/x`)).toBeNull();
});
it("keeps native fallback brands and non-HTTP schemes out of the built-in icon registry", () => {
  for (const href of [
    "https://box.com",
    "https://dropbox.com",
    "https://sharepoint.com",
    "ftp://github.com/x",
    "mailto:user@slack.com",
    "https://notion.com/x",
    "not a URL",
  ])
    expect(nativeLinkBrand(href)).toBeNull();
});
