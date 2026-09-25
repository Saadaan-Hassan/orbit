# Orbit API proxy (`orbit-api-proxy`)

A lightweight, stateless Cloudflare Worker. It exists to relay two provider
APIs — Groq and Voyage AI — from Orbit's desktop backend to `api.groq.com`
and `api.voyageai.com`. See the root [`README.md`](../README.md) for what
Orbit is and [`AGENTS.md`](../AGENTS.md) for the full architecture reference.

## What changed (COST-002)

Earlier versions of this Worker held maintainer-funded API keys for Claude,
Gemini, Groq, and Voyage AI as Cloudflare secrets, with an admin kill switch
to disable each centrally. That meant an anonymous caller who found this
Worker's URL — always public, since Cloudflare Workers are internet-reachable
by design — could spend the maintainer's real money on any of those
providers, with no authentication at all.

As of COST-002:

- **Claude and Gemini support has been removed entirely.** Neither was in
  active use (both were disabled via the former kill switch during the
  beta), and neither has a BYOK alternative anywhere in the app, so there was
  no reason to keep a live maintainer-funded credential exposed for them.
- **Groq and Voyage AI are pure bring-your-own-key (BYOK) passthroughs.**
  Every request must carry the caller's own provider key
  (`X-Groq-Api-Key` / `X-Voyage-Api-Key`); there is no fallback secret to
  reach for. An anonymous caller can now only ever spend *their own*
  provider credentials.

**This Worker requires zero secrets.** There is nothing to configure in
`.dev.vars` for local development and nothing to `wrangler secret put` before
deploying — `WorkerEnvironment` is intentionally an empty interface.

## Routes

| Route | Upstream | Auth |
|---|---|---|
| `POST /chat-groq` | `api.groq.com/openai/v1/chat/completions` | Requires `X-Groq-Api-Key` header (401 if absent) |
| `POST /embed` | `api.voyageai.com/v1/embeddings` | Requires `X-Voyage-Api-Key` header (401 if absent) |
| `POST /tts` | — | Stub, 501 (Phase 4) |
| `POST /stt-token` | — | Stub, 501 (Phase 4) |

Both live routes pipe the upstream response straight through — no buffering —
so Groq's streaming (`stream: true`) responses reach the caller
incrementally.

## Develop

```bash
npm install
npm run test    # vitest — routing, auth, and passthrough behavior, mocked fetch
npx wrangler dev
```

## Deploy

```bash
npx wrangler deploy
```

No `wrangler secret put` step is needed — there is nothing to configure.
