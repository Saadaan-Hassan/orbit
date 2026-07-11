export interface WorkerEnvironment {
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY: string;
  VOYAGE_AI_API_KEY: string;
  // Orbit-held shared Groq key, used when the caller doesn't supply its own
  // via the X-Groq-Api-Key header. During the beta, Groq is the sole AI
  // provider (Claude and Gemini disabled via the kill switch below), funded
  // centrally rather than requiring each beta tester to create a Groq
  // account — the per-user BYOK path still works if a header is present,
  // for whenever that's re-enabled in the app UI.
  GROQ_API_KEY: string;
  // Admin kill switch — plain Worker secrets, not bound to any AI provider's
  // own credentials. Absent/unset means enabled (fail-open). Flip with
  // `npx wrangler secret put CLAUDE_ENABLED` (value "false") — takes effect
  // on the next request, no redeploy needed.
  CLAUDE_ENABLED?: string;
  GEMINI_ENABLED?: string;
  GROQ_PROXY_ENABLED?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Groq-Api-Key",
};

// Default model names — the backend can override via query param if needed.
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const VOYAGE_API_BASE = "https://api.voyageai.com/v1";

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

// ── Admin kill switch ────────────────────────────────────────────────────────
// Each flag defaults to enabled (fail-open) unless explicitly set to the
// string "false". Flip with `npx wrangler secret put <NAME>` — takes effect
// on the next request, no redeploy needed.

function isEnabled(flag: string | undefined): boolean {
  return flag !== "false";
}

function providerDisabledResponse(providerName: string): Response {
  return corsResponse(
    JSON.stringify({
      error: `${providerName} is temporarily disabled by the admin. Try again later.`,
    }),
    503
  );
}

async function handleProviderStatusRequest(env: WorkerEnvironment): Promise<Response> {
  return corsResponse(
    JSON.stringify({
      claude: isEnabled(env.CLAUDE_ENABLED),
      gemini: isEnabled(env.GEMINI_ENABLED),
      groq: isEnabled(env.GROQ_PROXY_ENABLED),
    }),
    200
  );
}

// ── /chat ─────────────────────────────────────────────────────────────────────
// Thin proxy to Anthropic Messages API. Pipes the body straight through so
// SSE streaming works without buffering.

async function handleChatRequest(
  request: Request,
  env: WorkerEnvironment
): Promise<Response> {
  if (!isEnabled(env.CLAUDE_ENABLED)) return providerDisabledResponse("Claude");

  const requestBodyText = await request.text();

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: requestBodyText,
  });

  // Pipe upstream body so SSE streaming reaches the caller without buffering.
  return new Response(anthropicResponse.body, {
    status: anthropicResponse.status,
    headers: {
      "Content-Type":
        anthropicResponse.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
    },
  });
}

// ── /classify ─────────────────────────────────────────────────────────────────
// Thin proxy to the Gemini generateContent REST API.
//
// Request  (from FastAPI backend):
//   POST /classify?model=gemini-3.1-flash-lite          ← model is optional
//   Body: Gemini generateContent JSON body
//         { system_instruction, contents, generationConfig }
//
// The Worker injects the API key as a URL query param — it never travels
// over the wire between the desktop app and the Worker.

async function handleClassifyRequest(
  request: Request,
  requestUrl: URL,
  env: WorkerEnvironment
): Promise<Response> {
  if (!isEnabled(env.GEMINI_ENABLED)) return providerDisabledResponse("Gemini");

  const requestBodyText = await request.text();

  const modelName =
    requestUrl.searchParams.get("model") ?? DEFAULT_GEMINI_MODEL;

  const geminiUrl =
    `${GEMINI_API_BASE}/${modelName}:generateContent` +
    `?key=${env.GEMINI_API_KEY}`;

  const geminiResponse = await fetch(geminiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: requestBodyText,
  });

  const responseText = await geminiResponse.text();

  return new Response(responseText, {
    status: geminiResponse.status,
    headers: {
      "Content-Type":
        geminiResponse.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
    },
  });
}

// ── /embed ────────────────────────────────────────────────────────────────────
// Thin proxy to the Voyage AI embeddings API.
//
// Request  (from FastAPI backend):
//   POST /embed
//   Body: Voyage embeddings JSON body
//         { input: ["text..."], model: "voyage-3-lite", input_type: "document" }
//
// The Worker injects the Authorization header — the Voyage API key never
// leaves Cloudflare secrets.

async function handleEmbedRequest(
  request: Request,
  env: WorkerEnvironment
): Promise<Response> {
  const requestBodyText = await request.text();

  const voyageResponse = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.VOYAGE_AI_API_KEY}`,
      "content-type": "application/json",
    },
    body: requestBodyText,
  });

  const responseText = await voyageResponse.text();

  return new Response(responseText, {
    status: voyageResponse.status,
    headers: {
      "Content-Type":
        voyageResponse.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
    },
  });
}

// ── /chat-groq ───────────────────────────────────────────────────────────────
// Thin proxy to the Groq chat completions API. Uses the caller-supplied
// X-Groq-Api-Key header if present (per-user BYOK), otherwise falls back to
// the Orbit-held GROQ_API_KEY secret — this is what powers session
// generation, classification, and recall during the beta, without requiring
// each user to bring their own key.
//
// Pipes the response body straight through (not buffered) so streaming
// requests — recall uses stream: true, OpenAI/Groq-compatible SSE — reach
// the caller incrementally instead of arriving all at once at the end.

async function handleChatGroqRequest(
  request: Request,
  env: WorkerEnvironment
): Promise<Response> {
  if (!isEnabled(env.GROQ_PROXY_ENABLED)) return providerDisabledResponse("Groq");

  const groqApiKey = request.headers.get("X-Groq-Api-Key") ?? env.GROQ_API_KEY;
  if (!groqApiKey) {
    return corsResponse(JSON.stringify({ error: "No Groq API key available" }), 400);
  }

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
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const requestUrl = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = requestUrl.pathname;

    if (method === "OPTIONS") return handlePreflightRequest();

    if (method === "GET") {
      if (path === "/provider-status") return handleProviderStatusRequest(env);
    }

    if (method === "POST") {
      if (path === "/chat")      return handleChatRequest(request, env);
      if (path === "/chat-groq") return handleChatGroqRequest(request, env);
      if (path === "/classify")  return handleClassifyRequest(request, requestUrl, env);
      if (path === "/embed")     return handleEmbedRequest(request, env);
      if (path === "/tts")       return handleTtsRequest();
      if (path === "/stt-token") return handleSttTokenRequest();
    }

    return handleUnknownRoute();
  },
};
