// Orbit API proxy — a lightweight, stateless BYOK passthrough.
//
// COST-002: this Worker holds no maintainer-funded AI provider credential of
// any kind. Claude and Gemini support (previously maintainer-funded, no BYOK
// alternative anywhere in the app) has been removed entirely rather than
// proxied — neither was in active use (both were disabled via the former
// admin kill switch during the beta). Groq and Voyage AI remain as pure
// passthroughs: every request must carry the caller's own provider key in a
// header; there is no shared secret to fall back to and no `env` field for
// one to live in. An anonymous caller who finds this Worker's URL can spend
// only their own provider credentials, never the maintainer's.

export interface WorkerEnvironment {}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Groq-Api-Key, X-Voyage-Api-Key",
};

function corsResponse(
  body: string,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function missingKeyResponse(headerName: string): Response {
  return corsResponse(
    JSON.stringify({
      error: `Missing ${headerName} header. This Worker never supplies a shared ` +
        `provider key — every caller brings their own.`,
    }),
    401
  );
}

// ── /chat-groq ───────────────────────────────────────────────────────────────
// Thin proxy to the Groq chat completions API. Requires the caller's own key
// in X-Groq-Api-Key — no fallback. Pipes the response body straight through
// (not buffered) so streaming requests (recall uses stream: true) reach the
// caller incrementally instead of arriving all at once at the end.

async function handleChatGroqRequest(request: Request): Promise<Response> {
  const groqApiKey = request.headers.get("X-Groq-Api-Key");
  if (!groqApiKey) return missingKeyResponse("X-Groq-Api-Key");

  const requestBodyText = await request.text();

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "content-type": "application/json",
    },
    body: requestBodyText,
  });

  return new Response(groqResponse.body, {
    status: groqResponse.status,
    headers: {
      "Content-Type": groqResponse.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
    },
  });
}

// ── /embed ────────────────────────────────────────────────────────────────────
// Thin proxy to the Voyage AI embeddings API. Requires the caller's own key
// in X-Voyage-Api-Key — no fallback.

async function handleEmbedRequest(request: Request): Promise<Response> {
  const voyageApiKey = request.headers.get("X-Voyage-Api-Key");
  if (!voyageApiKey) return missingKeyResponse("X-Voyage-Api-Key");

  const requestBodyText = await request.text();

  const voyageResponse = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${voyageApiKey}`,
      "content-type": "application/json",
    },
    body: requestBodyText,
  });

  const responseText = await voyageResponse.text();

  return new Response(responseText, {
    status: voyageResponse.status,
    headers: {
      "Content-Type": voyageResponse.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
    },
  });
}

// ── stubs ─────────────────────────────────────────────────────────────────────

function handleTtsRequest(): Response {
  return corsResponse(
    JSON.stringify({ error: "TTS not yet enabled", phase: "phase-4" }),
    501
  );
}

function handleSttTokenRequest(): Response {
  return corsResponse(
    JSON.stringify({ error: "STT not yet enabled", phase: "phase-4" }),
    501
  );
}

function handlePreflightRequest(): Response {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

function handleUnknownRoute(): Response {
  return corsResponse(JSON.stringify({ error: "unknown route" }), 404);
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, _env: WorkerEnvironment): Promise<Response> {
    const requestUrl = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = requestUrl.pathname;

    if (method === "OPTIONS") return handlePreflightRequest();

    if (method === "POST") {
      if (path === "/chat-groq") return handleChatGroqRequest(request);
      if (path === "/embed")     return handleEmbedRequest(request);
      if (path === "/tts")       return handleTtsRequest();
      if (path === "/stt-token") return handleSttTokenRequest();
    }

    return handleUnknownRoute();
  },
};
