// Server-side only Supabase client initialised once at module level (singleton).
//
// Uses the secret key (sb_secret_xxx) introduced in Supabase's 2025 API key
// overhaul. The secret key replaces the legacy service_role JWT for server-side
// operations and bypasses Row Level Security just like the old key did.
//
// Get your secret key: Supabase dashboard → Settings → API Keys → Secret keys.
// (If your project still shows legacy keys, use the service_role value from the
// Legacy API Keys tab — both formats are accepted by createClient.)
//
// This file must NEVER be imported from client components — the secret key
// must not be bundled into the browser.
//
// Safe because:
//   - Next.js App Router tree-shakes server-only modules out of the client bundle.
//   - All callers ('use server' Server Actions, Route Handlers) run exclusively
//     on the server.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// SUPABASE_SECRET_KEY should hold the sb_secret_xxx value from
// Settings → API Keys → Secret keys (or the legacy service_role JWT).
// It is intentionally NOT prefixed with NEXT_PUBLIC_ so Next.js never
// exposes it to the browser bundle.
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local"
  );
}

// Singleton — module caching means this is created once per server process,
// not once per request.
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      // We are not managing user sessions here — this client only performs
      // server-side DB operations. Disabling auto-refresh avoids unnecessary
      // background work and removes any accidental cookie / localStorage access.
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
