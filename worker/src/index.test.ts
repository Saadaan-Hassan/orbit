import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "./index";

function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://worker.test${path}`, init);
}

describe("routing", () => {
  it("returns a CORS preflight response for OPTIONS on any path", async () => {
    const response = await worker.fetch(makeRequest("/chat-groq", { method: "OPTIONS" }), {});
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 404 for the removed /chat route", async () => {
    const response = await worker.fetch(makeRequest("/chat", { method: "POST" }), {});
    expect(response.status).toBe(404);
  });

  it("returns 404 for the removed /classify route", async () => {
    const response = await worker.fetch(makeRequest("/classify", { method: "POST" }), {});
    expect(response.status).toBe(404);
  });

  it("returns 404 for the removed GET /provider-status route", async () => {
    const response = await worker.fetch(makeRequest("/provider-status", { method: "GET" }), {});
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unsupported method on a known path", async () => {
    const response = await worker.fetch(makeRequest("/chat-groq", { method: "GET" }), {});
    expect(response.status).toBe(404);
  });
});

describe("auth — every remaining route requires the caller's own key", () => {
  it("rejects /chat-groq with no X-Groq-Api-Key header", async () => {
    const response = await worker.fetch(
      makeRequest("/chat-groq", { method: "POST", body: "{}" }),
      {}
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("X-Groq-Api-Key");
  });

  it("rejects /embed with no X-Voyage-Api-Key header", async () => {
    const response = await worker.fetch(
      makeRequest("/embed", { method: "POST", body: "{}" }),
      {}
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("X-Voyage-Api-Key");
  });
});

describe("passthrough — the caller's own key reaches the provider, nothing else does", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the caller's Groq key as a Bearer token to api.groq.com", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await worker.fetch(
      makeRequest("/chat-groq", {
        method: "POST",
        headers: { "X-Groq-Api-Key": "gsk_test_key" },
        body: JSON.stringify({ model: "llama" }),
      }),
      {}
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer gsk_test_key" });
  });

  it("never calls Groq at all when no key is supplied — there is no fallback to reach", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await worker.fetch(makeRequest("/chat-groq", { method: "POST", body: "{}" }), {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards the caller's Voyage key as a Bearer token to api.voyageai.com", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    await worker.fetch(
      makeRequest("/embed", {
        method: "POST",
        headers: { "X-Voyage-Api-Key": "voyage_test_key" },
        body: JSON.stringify({ input: ["x"] }),
      }),
      {}
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer voyage_test_key" });
  });

  it("never calls Voyage at all when no key is supplied", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await worker.fetch(makeRequest("/embed", { method: "POST", body: "{}" }), {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("no maintainer-funded credential surface remains (COST-002)", () => {
  it("the source references no provider secret env field at all", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
    expect(source).not.toMatch(
      /ANTHROPIC_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|VOYAGE_AI_API_KEY/
    );
  });
});
