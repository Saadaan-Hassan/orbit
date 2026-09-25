import { describe, expect, it } from "vitest";

import { isUrlCapturable } from "./url-capture";

describe("isUrlCapturable", () => {
  it("allows ordinary http/https pages", () => {
    expect(isUrlCapturable("https://example.com/article")).toBe(true);
    expect(isUrlCapturable("http://example.com")).toBe(true);
  });

  it("rejects browser-internal pages across Chrome, Edge, and Brave", () => {
    expect(isUrlCapturable("chrome://settings")).toBe(false);
    expect(isUrlCapturable("chrome-extension://abcdef/popup.html")).toBe(false);
    expect(isUrlCapturable("edge://settings")).toBe(false);
    expect(isUrlCapturable("brave://settings")).toBe(false);
  });

  it("rejects Safari extension pages", () => {
    expect(isUrlCapturable("safari-extension://abcdef/popup.html")).toBe(false);
  });

  it("rejects about: pages and local files", () => {
    expect(isUrlCapturable("about:blank")).toBe(false);
    expect(isUrlCapturable("file:///Users/me/secret.html")).toBe(false);
  });

  it("rejects an empty or missing URL", () => {
    expect(isUrlCapturable("")).toBe(false);
  });

  it("only matches on prefix, not substring, so a page merely mentioning a blocked scheme is still capturable", () => {
    expect(isUrlCapturable("https://example.com/how-to-use-chrome://settings")).toBe(true);
  });
});
