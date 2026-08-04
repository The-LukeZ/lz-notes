# lz-notes

Turns recorded meetings into structured notes (two flavors: regular meetings,
and "learning meetings" where one person teaches others), exportable as PDF,
DOCX, and Markdown. Speaker diarization is core — notes are generated from a
transcript that already knows who said what.

The full architecture and the decisions behind it live in [`PLAN.md`](./PLAN.md).

## Layout

pnpm workspace monorepo, one package per Cloudflare Worker:

- **`web/`** — SvelteKit app (`@sveltejs/adapter-cloudflare`). Serves the
  frontend + all HTTP API routes, and is the transcription queue **producer**.
- **`consumer/`** — small plain-TS Worker, no frontend. Queue **consumer** only;
  does the long-running Mistral transcription call and writes segments to D1.
- **`db/schema.sql`** — the D1 schema (hand-written for now; Drizzle later).

Both workers bind the **same** D1 database and R2 bucket (identical resource IDs
in both `wrangler.jsonc` files).

## Prerequisites

- Node 22+, pnpm 10+
- A Cloudflare account on the Workers **Paid** plan (headroom for long jobs)
- A Mistral API key

## Setup

```sh
pnpm install
```

### 1. Provision Cloudflare resources

```sh
wrangler d1 create lz-notes-db
wrangler r2 bucket create lz-notes-audio
wrangler queues create lz-notes-transcription-jobs
wrangler queues create lz-notes-transcription-jobs-dlq
```

Paste the `database_id` returned by `d1 create` into **both**
`web/wrangler.jsonc` and `consumer/wrangler.jsonc` (replace
`REPLACE_WITH_D1_DATABASE_ID` in each — they must match, it's one shared DB).

Apply the schema:

```sh
pnpm db:apply          # remote (production D1)
pnpm db:apply:local    # local dev D1
```

### 2. Secrets

`MISTRAL_API_KEY` is declared as a required secret in both `wrangler.jsonc`
files, so it's validated on deploy and drives type generation.

```sh
cd web && wrangler secret put MISTRAL_API_KEY && cd ..
cd consumer && wrangler secret put MISTRAL_API_KEY && cd ..
```

For local development, copy `.env.example` to `.env` in each package
and fill in the key.

### 3. Run / typecheck / deploy

```sh
pnpm dev       # web app (vite dev) — emulates bindings from wrangler.jsonc
pnpm check     # typecheck both packages
pnpm deploy    # deploy web + consumer
```

## ⚠️ Before trusting transcription: verify the response shape

The exact JSON shape of Mistral's diarized transcription response was **not**
confirmed during planning. `consumer/src/mistral.ts` ships a best-guess parser
(`parseTranscriptionResponse`, assuming `{ segments: [{ speaker, text, start,
end }] }`) that logs the raw response and throws clearly on a mismatch rather
than silently producing garbage.

Make one real call against a short multi-speaker clip, inspect the actual JSON
(`wrangler tail lz-notes-consumer` during a test run, or a standalone curl), and
fix the field names in that function before relying on it. See `PLAN.md` §1/§10.

## Notes

- **No auth.** This is a single-user personal tool intended for a private URL.
  There is no authentication on any route — do not expose it publicly, or add
  auth first if you do. (PLAN §11)
- **Live status** is done by client polling (`GET /api/meetings/:id/status`),
  not WebSockets/Durable Objects.
- **Exports:** Markdown is the stored source of truth (raw LLM output); DOCX
  (`docx`) and PDF (`pdf-lib`) are generated from it on demand.
