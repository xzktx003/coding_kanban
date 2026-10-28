import {
  normaliseServerUrl,
  validateServerUrl,
} from "../config";

describe("normaliseServerUrl", () => {
  it("prepends http:// when no scheme is given", () => {
    expect(normaliseServerUrl("10.30.0.24:3000")).toBe("http://10.30.0.24:3000");
  });
  it("trims trailing slashes", () => {
    expect(normaliseServerUrl("http://10.30.0.24:3000/")).toBe("http://10.30.0.24:3000");
  });
  it("keeps an https URL intact", () => {
    expect(normaliseServerUrl("  https://example.com  ")).toBe("https://example.com");
  });
  it("throws on a non-http protocol", () => {
    expect(() => normaliseServerUrl("ftp://x")).toThrow();
  });
});

describe("validateServerUrl", () => {
  it("rejects empty input", () => {
    expect(validateServerUrl("   ")).toBe("EMPTY");
  });
  it("rejects invalid host / protocol", () => {
    expect(validateServerUrl("not a url")).not.toBeNull();
    expect(validateServerUrl("ftp://x")).not.toBeNull();
  });
  it("accepts a host:port", () => {
    expect(validateServerUrl("10.30.0.24:3000")).toBeNull();
    expect(validateServerUrl("http://10.30.0.24:3000")).toBeNull();
  });
});
