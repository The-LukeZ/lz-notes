# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

lz-notes: turns recorded meetings into structured notes (two flavors — regular
meetings, and "learning meetings" where one person teaches others), exportable
as PDF, DOCX, and Markdown. Speaker diarization is core: notes are generated
from a transcript that already knows who said what. Single-user personal tool,
**no auth** on any route — never expose it publicly without adding auth first.

Full architecture and the reasoning behind every decision lives in
[`PLAN.md`](./PLAN.md) — read it before making structural changes. Don't
re-derive decisions already settled there.

**Before doing anything Svelte / `adapter-cloudflare` / Workers-bindings
related**: this repo has `.claude/refs/` checked in with full Svelte docs and
a Cloudflare Workers docs reference. Consult those (or the `svelte` MCP
tools/skills) instead of relying on training data. There is no Mistral docs
ref checked in — everything Mistral-API-shaped is spelled out in `PLAN.md`
§1/§7.

## Commands

**WSL NOTICE:** Do not run any pnpm commands in WSL. Tell user to use Windows Terminal or Powershell instead.

```sh
pnpm install
pnpm dev            # web app only (vite dev, emulates bindings from wrangler.jsonc)
pnpm check           # typecheck both packages (wrangler types + svelte-check / tsc)
pnpm build            # build web then consumer
pnpm deploy            # deploy web + consumer
pnpm format             # prettier --write .
pnpm db:apply             # apply db/schema.sql to remote D1
```

Per-package (run inside `web/` or `consumer/`):

```sh
pnpm dev      # consumer: wrangler dev (no dev server for web here — use root pnpm dev)
pnpm check    # wrangler types --check + svelte-check (web) / tsc --noEmit (consumer)
pnpm gen      # wrangler types — regenerate worker-configuration.d.ts after wrangler.jsonc changes
```

No test suite exists in this repo currently.

## Architecture

pnpm workspace monorepo, **exactly two packages, one per Cloudflare Worker** —
no `apps/` nesting, no shared `packages/db`:

- **`web/`** — SvelteKit app (`@sveltejs/adapter-cloudflare`). Serves the
  frontend, all HTTP API routes, and is the transcription queue **producer**.
- **`consumer/`** — small plain-TS worker, no frontend. Queue **consumer**
  only — does the long-running Mistral transcription call and writes
  segments to D1.

Two workers instead of one because `adapter-cloudflare` cannot attach a queue
consumer to the same worker that serves the SvelteKit app (confirmed upstream
limitation). Both bind the **same** D1 database and R2 bucket — the
`database_id` in `web/wrangler.jsonc` and `consumer/wrangler.jsonc` must match
exactly, it's one shared DB.

### DB access: `NotesRepository`

All D1 access goes through one repository class per worker:
`web/src/lib/server/db.ts` (full method set) and `consumer/src/db.ts` (subset
the consumer needs: `getMeeting`, `updateStatus`, `insertSegments`). **No file
outside these two ever calls `.prepare()`/`.batch()` on `D1Database`
directly** — route handlers and the queue consumer only call repo methods.

The two files are **intentionally duplicated**, not shared via a workspace
package (deliberate per the two-package layout). Keep method signatures
identical between the two where they overlap. `db/schema.sql` is
hand-written for now; Drizzle is planned but not wired in — see `PLAN.md` §3
for the migration path (constructor becomes `DrizzleD1Database`, method
bodies get rewritten, public signatures shouldn't need to change).

### Data flow / job lifecycle

Meeting `status` progresses: `uploaded -> queued -> transcribing ->
transcribed -> notes_ready | failed` (see `db/schema.sql`).

1. Browser uploads audio directly to R2 via the R2 binding
   (`env.AUDIO_BUCKET.put(...)`) through a `web/` API route — no presigned
   URLs, no AWS SDK.
2. `web/` enqueues `{ meetingId }` onto `TRANSCRIBE_QUEUE`, sets `status:
   queued`.
3. `consumer/` picks up the job (`max_batch_size: 1` deliberately — each job
   is one long transcription call, batching buys nothing), sets `status:
   transcribing`, pulls audio from R2, calls Mistral
   (`voxtral-mini-latest`, diarized), writes segments via
   `repo.insertSegments`, sets `status: transcribed`. On error: `status:
   failed` + `msg.retry()` (3 retries, then the DLQ).
4. Client polls `GET /api/meetings/:id/status` for live status — no
   WebSockets/Durable Objects.
5. User renames speakers (`POST .../speakers`), triggers note generation
   (`POST .../notes` — one synchronous Mistral chat-completions call,
   `mistral-large-latest`, prompt picked by `meeting_type`, see
   `web/src/lib/server/templates.ts`), then exports via
   `GET .../export/:format` (`md`|`docx`|`pdf`).

Full API contract is in `PLAN.md` §6.

### Exports

Markdown is the stored source of truth (raw LLM output, deliberately
constrained to headings/bullets/paragraphs by the prompt templates). DOCX and
PDF are generated from it on demand:

- `web/src/lib/server/export/parse.ts` — minimal markdown -> `Block[]` parser
  (`heading|bullet|paragraph`), not a general markdown engine.
- `docx.ts` — `Block[]` -> `docx` package `Paragraph[]`, `Packer.toBlob`
  (not `toBuffer` — needed for Workers runtime portability).
- `pdf.ts` — `Block[]` -> `pdf-lib`, hand-rolled pagination/word-wrap (no
  markdown/HTML support in `pdf-lib`).

### ⚠️ Known unverified area

`consumer/src/mistral.ts`'s `parseTranscriptionResponse` is a best-guess
parser assuming an OpenAI-style `{ segments: [{ speaker, text, start, end }]
}` shape from Mistral's diarized transcription response — this was **not**
confirmed against a real API response during planning. It logs the raw
response and throws clearly on mismatch rather than silently producing
garbage. Before trusting transcription output, make one real call against a
short multi-speaker clip and fix the field names against the actual shape
(see README "Before trusting transcription" and `PLAN.md` §1/§10).

## Conventions

- Env/secrets: `MISTRAL_API_KEY` is a required secret in both
  `wrangler.jsonc` files (validates on deploy, drives type generation). Local
  dev: copy `.env.example` to `.env` in each package.
- After editing either `wrangler.jsonc`, regenerate types with `pnpm gen`
  (updates `worker-configuration.d.ts`) before typechecking.
- Formatting: Prettier with `prettier-plugin-svelte` and
  `prettier-plugin-tailwindcss` — run `pnpm format` at the repo root, not
  per-package.
- **Local dev D1/R2 state**: `web`'s dev server (`vite dev` via
  `adapter-cloudflare`'s `getPlatformProxy`) always persists local D1/R2 data
  to `web/.wrangler/state` — its `platformProxy.persist.path` option in
  `vite.config.ts` is **not honored in `vite dev`** (only affects
  build/preview), so this location can't be changed from that side. `consumer`
  therefore points at it explicitly: `consumer/package.json`'s `dev` and
  `db:apply:local` scripts pass `--persist-to ../web/.wrangler/state`. If you
  see the consumer log a queue delivery but then `meeting not found` and drop
  the message, the two workers' local DBs have diverged — check that
  `--persist-to` flag hasn't drifted from `web/.wrangler/state`. This is a
  local-dev-only quirk; both workers bind the same real D1/R2 in
  preview/prod.
