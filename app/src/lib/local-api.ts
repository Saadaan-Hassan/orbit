import { invoke } from "@tauri-apps/api/core";

import { BACKEND_BASE_URL } from "./config";

let sessionToken: string | null = null;
let sessionTokenRequest: Promise<string> | null = null;

async function getSessionToken(): Promise<string> {
  if (sessionToken) return sessionToken;

  sessionTokenRequest ??= invoke<string>("get_local_api_session_token")
    .then((token) => {
      if (!token) throw new Error("Orbit local API authentication is unavailable.");
      sessionToken = token;
      return token;
    })
    .finally(() => {
      sessionTokenRequest = null;
    });

  return sessionTokenRequest;
}

/**
 * The only webview-to-sidecar transport. It retains the per-session token in
 * module memory only, never in browser storage, URLs, telemetry, or Vite env.
 */
export async function orbitApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/")) throw new Error("Orbit API paths must start with '/'.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await getSessionToken()}`);

  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "omit",
  });

  if (response.status === 401) {
    // The sidecar may have restarted. Do not retry implicitly; callers can show
    // a safe error and the next explicit request will acquire a fresh token.
    clearOrbitApiSession();
  }
  return response;
}

export function clearOrbitApiSession(): void {
  sessionToken = null;
  sessionTokenRequest = null;
}
