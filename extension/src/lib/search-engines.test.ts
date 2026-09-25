import { describe, expect, it } from "vitest";

import { detectSearchQuery } from "./search-engines";

describe("detectSearchQuery", () => {
  it("detects a Google search", () => {
    expect(detectSearchQuery("https://www.google.com/search?q=orbit+memory+app")).toEqual({
      query: "orbit memory app",
      engineName: "Google",
    });
  });

  it("detects Google on a non-.com TLD", () => {
    expect(detectSearchQuery("https://www.google.co.uk/search?q=test")).toEqual({
      query: "test",
      engineName: "Google",
    });
  });

  it("detects a YouTube search", () => {
    expect(detectSearchQuery("https://www.youtube.com/results?search_query=rust+tauri")).toEqual({
      query: "rust tauri",
      engineName: "YouTube",
    });
  });

  it("detects a Bing search", () => {
    expect(detectSearchQuery("https://www.bing.com/search?q=hello")).toEqual({
      query: "hello",
      engineName: "Bing",
    });
  });

  it("detects a DuckDuckGo search at the root path", () => {
    expect(detectSearchQuery("https://duckduckgo.com/?q=privacy")).toEqual({
      query: "privacy",
      engineName: "DuckDuckGo",
    });
  });

  it("returns null for a non-search page on a search engine's domain", () => {
    expect(detectSearchQuery("https://www.google.com/maps")).toBeNull();
  });

  it("returns null for an unrelated site", () => {
    expect(detectSearchQuery("https://example.com/article")).toBeNull();
  });

  it("returns null when the search path matches but the query param is empty", () => {
    expect(detectSearchQuery("https://www.google.com/search?q=")).toBeNull();
  });

  it("does not match a lookalike hostname that merely contains the engine's domain", () => {
    expect(detectSearchQuery("https://notgoogle.com.evil.example/search?q=test")).toBeNull();
  });
});
