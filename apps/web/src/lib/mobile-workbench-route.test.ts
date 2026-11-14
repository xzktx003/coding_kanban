import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isMobileWorkbenchLocation,
  mobileWorkbenchLayoutUrl,
  readMobileWorkbenchLayout,
} from "./mobile-workbench-route.js";

describe("mobile workbench route", () => {
  it("accepts history routes when the server supports SPA fallback", () => {
    assert.equal(
      isMobileWorkbenchLocation({
        hash: "",
        pathname: "/mobile",
        search: "",
      }),
      true,
    );
  });

  it("accepts query routes so phones can enter through the root page", () => {
    assert.equal(
      isMobileWorkbenchLocation({
        hash: "",
        pathname: "/",
        search: "?view=mobile",
      }),
      true,
    );
  });

  it("accepts hash routes for strict static hosts", () => {
    assert.equal(
      isMobileWorkbenchLocation({
        hash: "#/mobile",
        pathname: "/",
        search: "",
      }),
      true,
    );
  });

  it("keeps normal desktop routes unchanged", () => {
    assert.equal(
      isMobileWorkbenchLocation({
        hash: "",
        pathname: "/",
        search: "",
      }),
      false,
    );
  });

  it("reads explicit wide and narrow mobile layouts", () => {
    assert.equal(
      readMobileWorkbenchLayout({ search: "?view=mobile&layout=wide" }),
      "wide",
    );
    assert.equal(
      readMobileWorkbenchLayout({ search: "?view=mobile&layout=narrow" }),
      "narrow",
    );
    assert.equal(readMobileWorkbenchLayout({ search: "?view=mobile" }), null);
  });

  it("builds a stable mobile layout URL without dropping existing parameters", () => {
    assert.equal(
      mobileWorkbenchLayoutUrl(
        { pathname: "/", search: "?view=mobile&session=s-1", hash: "" },
        "narrow",
      ),
      "/?view=mobile&session=s-1&layout=narrow",
    );
  });
});
