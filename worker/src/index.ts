export interface WorkerEnvironment {
  ANTHROPIC_API_KEY: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function corsResponse(body: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

async function handleChatRequest(request: Request, env: WorkerEnvironment): Promise<Response> {
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

  // Pipe the upstream response body directly back to the caller so that
  // SSE streaming works without buffering the entire response in the Worker.
  return new Response(anthropicResponse.body, {
    status: anthropicResponse.status,
    headers: {
      "Content-Type": anthropicResponse.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
    },
  });
}

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
  return new Response(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}

function handleUnknownRoute(): Response {
  return corsResponse(JSON.stringify({ error: "unknown route" }), 404);
}

export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const requestUrl = new URL(request.url);
    const requestMethod = request.method.toUpperCase();
    const requestPathname = requestUrl.pathname;

    if (requestMethod === "OPTIONS") {
      return handlePreflightRequest();
    }

    if (requestMethod === "POST" && requestPathname === "/chat") {
      return handleChatRequest(request, env);
    }

    if (requestMethod === "POST" && requestPathname === "/tts") {
      return handleTtsRequest();
    }

    if (requestMethod === "POST" && requestPathname === "/stt-token") {
      return handleSttTokenRequest();
    }

    return handleUnknownRoute();
  },
};
