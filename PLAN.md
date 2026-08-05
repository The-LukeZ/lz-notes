# lz-notes — Build Plan

Turns recorded meetings into structured notes (two flavors: regular meetings,
and "learning meetings" where one person teaches others), exportable as PDF,
DOCX, and Markdown. Speaker diarization is the core requirement — notes are
generated from a transcript that already knows who said what.

This doc is the spec. Build against it; don't re-derive the architecture
decisions below, they're already settled.

**Before doing anything else**: this repo has `.claude/refs/` checked in,
with the full Svelte docs and a Cloudflare Workers docs reference. Consult
those first for anything SvelteKit / `adapter-cloudflare` / Workers-bindings
related, instead of relying on training data. Assume this plan plus those
refs are the only source material available — there is no Mistral docs ref
checked in, so everything Mistral-API-shaped that this app needs is spelled
out explicitly below. Where something below is marked unverified, don't fill
the gap with a guess dressed up as fact — do the verification step or flag
it back.

---

## 1. Decisions already made

- **Package manager**: pnpm. Repo is a pnpm workspace monorepo with exactly
  two packages, `web/` and `consumer/` — one per Cloudflare Worker. No
  `apps/` nesting layer, no shared `packages/db` — see §3 for why the DB
  layer is duplicated instead of shared.

- **Transcription + diarization**: Mistral's `voxtral-mini-latest` model via
  `POST https://api.mistral.ai/v1/audio/transcriptions` with `diarize=true`.
  Confirmed working request format:

  ```
  curl -X POST "https://api.mistral.ai/v1/audio/transcriptions" \
    -H "Authorization: Bearer $MISTRAL_API_KEY" \
    -F model="voxtral-mini-latest" \
    -F file=@"recording.m4a" \
    -F diarize=true \
    -F timestamp_granularities="segment"
  ```

  Other useful params: `context_bias` (single comma-separated string, up to
  100 words/phrases — good for names/jargon; confirmed against
  `.claude/refs/transcription-voxtral.md`), `language` (skip it and Mistral
  auto-detects).

- **Note generation**: Mistral `mistral-large-latest` via
  `POST https://api.mistral.ai/v1/chat/completions` (standard chat
  completions, JSON body, `messages: [{role, content}]`):

  ```
  curl https://api.mistral.ai/v1/chat/completions \
    -H "Authorization: Bearer $MISTRAL_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "mistral-large-latest",
      "messages": [
        {"role": "system", "content": "..."},
        {"role": "user", "content": "<transcript text>"}
      ]
    }'
  ```

  Response: `data.choices[0].message.content`. One synchronous call — fast
  enough to not need the queue.

- **Two Cloudflare Workers, not one.** `@sveltejs/adapter-cloudflare`
  cannot attach a queue consumer to the same worker that also serves the
  SvelteKit app (confirmed — open feature request upstream, no ETA). So:
  - `web/` — SvelteKit app (adapter-cloudflare). Serves the frontend + all
    HTTP API routes. Also the queue **producer**.
  - `consumer/` — small plain TS worker, no frontend. Queue **consumer**
    only. Does the actual (long-running) transcription call and writes
    results to D1.
  - Both bind the same D1 database and R2 bucket (same resource IDs in both
    `wrangler.jsonc` files).

- **Audio upload path**: browser → SvelteKit endpoint → R2, using the R2
  binding directly (`env.AUDIO_BUCKET.put(...)`), not presigned URLs.
  Simpler, no AWS SDK dependency. Cloudflare's request body limit (100MB
  Free/Pro, 200MB Business) is generous enough for compressed meeting audio;
  revisit only if that becomes a real constraint.

- **Why Workers are fine for a "long" transcription job at all**: Workers
  CPU-time limits only count active compute, not time spent waiting on
  `fetch()`. The actual transcription work happens on Mistral's servers;
  the consumer worker is mostly idle-waiting on that request, which doesn't
  burn the CPU-time budget (and the account is on Workers Paid, so there's
  headroom regardless — default 30s CPU time, configurable to 5 min). No
  need for Cloudflare Containers here — those would only matter if this
  later did something CPU-heavy itself (local ffmpeg preprocessing, a
  self-hosted model, etc).

- **Live status**: polling (`GET /api/meetings/:id/status` every few
  seconds from the client), not WebSocket/Durable Objects. DO support would
  require either a community adapter fork or a third worker; not worth the
  complexity for a personal tool. Can upgrade later.

- **Export formats**: Markdown is the stored source of truth (raw LLM
  output). DOCX via the `docx` npm package, PDF via `pdf-lib` — both pure
  JS, no native bindings, both run fine in the Workers runtime. Notes are
  deliberately kept to a simple markdown subset (headings, bullets,
  paragraphs — see prompt templates in §6) so a minimal hand-written parser
  can drive both exporters without needing a full markdown engine.

- **Installable**: static `web/static/manifest.json` + a `<link rel="manifest">`
  in `web/src/app.html` — plain, no service worker. `@vite-pwa/sveltekit`
  was tried first but its generated manifest/registration didn't work in
  this setup; the static-file approach (confirmed working in the sibling
  `redditdwnld` repo) is simpler and doesn't need a plugin at all.

- **Glossary / context bias**: optional per-meeting textarea (one term per
  line) collected in the upload form, stored as `meetings.glossary`
  (newline-separated, nullable), split and joined into Mistral's
  `context_bias` form field (comma-separated, up to 100 terms) in
  `consumer/src/mistral.ts`. See `.claude/refs/transcription-voxtral.md`
  for the confirmed API shape.

---

## 2. Repo layout

```
lz-notes/
  package.json                  # pnpm workspace root
  pnpm-workspace.yaml            # packages: web, consumer
  .claude/refs/                  # Svelte docs + Cloudflare Workers docs (already present)
  db/
    schema.sql                   # hand-written for now; becomes Drizzle-generated later (see §3)
  web/                           # SvelteKit app — frontend + API + queue producer
    package.json
    svelte.config.js
    vite.config.ts
    wrangler.jsonc
    tsconfig.json
    src/
      app.html
      app.d.ts                   # Platform.env types (DB, AUDIO_BUCKET, TRANSCRIBE_QUEUE, MISTRAL_API_KEY)
      lib/server/
        db.ts                    # NotesRepository — all D1 access, see §3
        mistral.ts                # generateNotes() — chat completions only
        templates.ts              # system prompts + buildTranscriptText()
        export/
          parse.ts                 # markdown -> Block[] (heading/bullet/paragraph)
          markdown.ts               # trivial passthrough exporter
          docx.ts                   # Block[] -> docx Blob
          pdf.ts                    # Block[] -> pdf bytes
      routes/
        +page.svelte               # meeting list + upload form
        +page.server.ts            # load(): repo.listMeetings()
        meeting/[id]/+page.svelte      # transcript view, speaker rename, generate notes, export buttons
        meeting/[id]/+page.server.ts   # load(): repo.getMeeting() + getSegments() + getNotes()
        api/
          meetings/+server.ts                 # POST create+upload (multipart: file, title, meetingType)
          meetings/[id]/+server.ts            # GET meeting detail (meeting + segments + notes)
          meetings/[id]/status/+server.ts     # GET { status, error }
          meetings/[id]/speakers/+server.ts   # POST { mapping: Record<label,name> }
          meetings/[id]/notes/+server.ts      # POST -> generates + stores + returns markdown
          meetings/[id]/export/[format]/+server.ts # GET -> md|docx|pdf file download
  consumer/                     # queue consumer worker — no frontend
    package.json
    wrangler.jsonc
    tsconfig.json
    src/
      env.d.ts                  # Env type (DB, AUDIO_BUCKET, MISTRAL_API_KEY) + TranscribeBatch
      db.ts                     # NotesRepository — subset used here, see §3
      mistral.ts                # transcribeAudio() + parseTranscriptionResponse() (⚠️ see §1)
      index.ts                  # queue() handler
```

**Status of this scaffold**: `db/schema.sql`, both `wrangler.jsonc`, both
`package.json`, the pnpm workspace files, and everything under `web/src/lib`
and `consumer/src` listed above already exist and are implemented — not just
stubbed. What's left is primarily the Svelte routes/pages (`web/src/routes/`)
and the response-shape verification in §1.

---

## 3. The DB layer: `NotesRepository` (Drizzle-ready, not Drizzle-yet)

Drizzle is coming later but isn't wired in yet. Rather than scatter
`env.DB.prepare(...)` calls across route handlers and the queue consumer,
**all D1 access goes through one class per worker**: `NotesRepository` in
`web/src/lib/server/db.ts` and `consumer/src/db.ts`.

Rules to keep this useful:

- No file outside these two ever calls `.prepare()` / `.batch()` on a
  `D1Database` directly. Route handlers and the queue consumer only ever
  call repository methods (`repo.getMeeting(id)`, `repo.insertSegments(...)`,
  etc).
- The two files are **intentionally duplicated**, not shared via a
  workspace package — the repo layout is two packages, not three, per the
  decision in §1. `consumer/src/db.ts` only implements the methods the
  consumer actually calls (`getMeeting`, `updateStatus`, `insertSegments`);
  `web/src/lib/server/db.ts` implements the full set. Keep method
  signatures identical between the two where they overlap.
- Migration path, when Drizzle lands: the constructor changes from
  `constructor(private db: D1Database)` to something like
  `constructor(private db: DrizzleD1Database)`, and each method body gets
  rewritten against the Drizzle query builder / schema. The public method
  signatures (`getMeeting(id): Promise<Meeting | null>`, etc.) shouldn't
  need to change, which means nothing calling the repository — no route
  handler, no queue handler — should need to change either. `db/schema.sql`
  gets replaced by a Drizzle schema file + `drizzle-kit` generated
  migrations at that point.

Current method set (already implemented):

```ts
class NotesRepository {
  constructor(private db: D1Database) {}

  // web only:
  createMeeting(params: { id; title; meetingType; audioKey }): Promise<void>;
  listMeetings(): Promise<Meeting[]>;
  getSegments(meetingId): Promise<Segment[]>;
  updateSpeakerNames(meetingId, mapping: Record<string, string>): Promise<void>;
  saveNotes(meetingId, markdown): Promise<void>;
  getNotes(meetingId): Promise<string | null>;

  // both web and consumer:
  getMeeting(id): Promise<Meeting | null>;
  updateStatus(id, status, error?): Promise<void>;
  insertSegments(meetingId, segments: NewSegment[]): Promise<void>;
}
```

---

## 4. D1 schema

Already written (`db/schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_type TEXT NOT NULL CHECK (meeting_type IN ('meeting', 'learning')),
  status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded -> queued -> transcribing -> transcribed -> notes_ready | failed
  audio_key TEXT NOT NULL,
  glossary TEXT, -- optional newline-separated context_bias terms for transcription
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  speaker_label TEXT NOT NULL,
  speaker_name TEXT,
  text TEXT NOT NULL,
  start_time REAL,
  end_time REAL
);
CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id);

CREATE TABLE IF NOT EXISTS notes (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 5. Cloudflare resources to provision

```
wrangler d1 create lz-notes-db
wrangler r2 bucket create lz-notes-audio
wrangler queues create lz-notes-transcription-jobs
wrangler queues create lz-notes-transcription-jobs-dlq
wrangler d1 execute lz-notes-db --file=./db/schema.sql --remote

# secrets, once per worker:
cd web && wrangler secret put MISTRAL_API_KEY && cd ..
cd consumer && wrangler secret put MISTRAL_API_KEY && cd ..
```

After `d1 create`, paste the returned `database_id` into **both**
`web/wrangler.jsonc` and `consumer/wrangler.jsonc` (currently
`REPLACE_WITH_D1_DATABASE_ID` in both — they must match, it's one shared
database).

Both `wrangler.jsonc` files already exist with the right bindings
(`DB`, `AUDIO_BUCKET`, and `TRANSCRIBE_QUEUE`/queue consumer config
respectively) and resource names (`lz-notes-db`, `lz-notes-audio`,
`lz-notes-transcription-jobs`). `consumer`'s queue consumer is configured
with `max_batch_size: 1` on purpose — each job is a long transcription
call, batching multiple per invocation buys nothing and complicates
ack/retry logic.

---

## 6. API contract (web/)

| Route                              | Method | Body / params                                                                                                                         | Response                                                                                                                                                                                                                           |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/meetings`                    | POST   | `multipart/form-data`: `file` (audio), `title`, `meetingType` (`meeting`\|`learning`), `glossary` (optional, newline-separated terms) | `{ id }` — creates D1 row via `repo.createMeeting()` (`status: uploaded`), streams file into R2 at key `audio/{id}/{filename}`                                                                                                     |
| `/api/meetings/:id/transcribe`     | POST   | —                                                                                                                                     | enqueues `{ meetingId }` to `TRANSCRIBE_QUEUE`, sets `status: queued` via `repo.updateStatus()`, `202`                                                                                                                             |
| `/api/meetings/:id`                | GET    | —                                                                                                                                     | `{ meeting, segments, notes }`                                                                                                                                                                                                     |
| `/api/meetings/:id/status`         | GET    | —                                                                                                                                     | `{ status, error }` — for polling                                                                                                                                                                                                  |
| `/api/meetings/:id/speakers`       | POST   | `{ mapping: { "SPEAKER_00": "Maria", ... } }`                                                                                         | `204`, calls `repo.updateSpeakerNames()`                                                                                                                                                                                           |
| `/api/meetings/:id/notes`          | POST   | —                                                                                                                                     | builds transcript text from segments via `buildTranscriptText()` (prefers `speaker_name`, falls back to `speaker_label`), picks prompt by `meeting_type` (§7), calls `generateNotes()`, `repo.saveNotes()`, returns `{ markdown }` |
| `/api/meetings/:id/export/:format` | GET    | `:format` = `md`\|`docx`\|`pdf`                                                                                                       | file download with correct `Content-Type`/`Content-Disposition`, built from `repo.getNotes()` via the matching `export/*.ts` module                                                                                                |

Frontend flow: upload form → POST `/api/meetings` → POST
`.../transcribe` → poll `.../status` until `transcribed` → fetch `GET
/api/meetings/:id`, show transcript with an editable name field per unique
`speaker_label` → POST `.../speakers` → POST `.../notes` → show markdown +
three export buttons hitting `.../export/:format`.

---

## 7. Prompt templates (verbatim — already implemented in `web/src/lib/server/templates.ts`)

```ts
export const MEETING_SYSTEM_PROMPT = `You are an assistant that converts a raw, speaker-labeled meeting transcript into clean, structured notes in Markdown.

Produce notes with these sections, omitting any that genuinely have nothing to report:
## Summary
A short (3-5 sentence) overview of what the meeting was about.
## Topics Discussed
Bullet points, grouped by topic, capturing what was actually said and by whom when relevant.
## Decisions Made
Bullet points. Be explicit about what was decided.
## Action Items
A bullet list in the form "- [Owner] Task" — infer the owner from who volunteered or was assigned the task in the transcript. If no owner is clear, write "[Unassigned]".
## Open Questions
Anything raised but not resolved.

Do not invent information that is not in the transcript. If a section would be empty, omit it entirely rather than writing "None".`;

export const LEARNING_SYSTEM_PROMPT = `You are an assistant that converts a raw, speaker-labeled transcript of a learning session (one or more people teaching others) into clear study notes in Markdown.

Produce notes with these sections, omitting any that genuinely have nothing to report:
## Summary
A short overview of what was taught and by whom.
## Key Concepts
Bullet points or short subsections per concept, explained clearly in your own words based on what the teacher said. Include definitions the teacher gave.
## Examples Given
Any worked examples, analogies, or demonstrations the teacher used.
## Questions & Answers
Notable questions students asked, and the answers given, as a "Q: ... / A: ..." list.
## Follow-ups / Further Reading
Anything the teacher mentioned as homework, next steps, or further resources.

Do not invent information that is not in the transcript. If a section would be empty, omit it entirely rather than writing "None".`;
```

`buildTranscriptText(segments)`: `segments.map(s => \`${s.speaker_name ?? s.speaker_label}: ${s.text}\`).join('\n')` — already implemented.

---

## 8. Export approach (already implemented except docx.ts / pdf.ts)

1. `parseMarkdownBlocks(markdown)` in `web/src/lib/server/export/parse.ts` —
   done. A deliberately minimal parser (the templates above only ever
   produce `#`/`##`/`###` headings, `- ` bullets, and plain paragraphs — no
   tables/bold/nesting). Returns `Block[]` =
   `{type:'heading',level,text} | {type:'bullet',text} | {type:'paragraph',text}`.
2. `markdown.ts` — done. Passthrough, `TextEncoder().encode(markdown)`.
3. `docx.ts` — **not yet written**. Map `Block[]` to `docx` package
   `Paragraph`s (`HeadingLevel.HEADING_1/2/3` for headings, bullet style for
   bullets), `Packer.toBlob(doc)` — use `toBlob` not `toBuffer`, it's the
   portable choice across the Workers runtime.
4. `pdf.ts` — **not yet written**. `pdf-lib` — manually paginate: draw each
   block's text with word wrap at page width, larger/bold font for
   headings, indent + bullet glyph for bullets, add a new page when `y` runs
   past the bottom margin. `pdf-lib` has no markdown/HTML support, this has
   to be hand-rolled; keep it simple (one font, no tables) — good enough for
   notes.

---

## 9. Consumer worker (already implemented: `consumer/src/index.ts`, `db.ts`, `mistral.ts`, `env.d.ts`)

Logic, for reference:

```
queue(batch, env):
  repo = new NotesRepository(env.DB)
  for msg of batch.messages:
    meeting = await repo.getMeeting(msg.body.meetingId)
    if !meeting: msg.ack(); continue   # deleted mid-flight
    try:
      repo.updateStatus(meeting.id, 'transcribing')
      audio = await env.AUDIO_BUCKET.get(meeting.audio_key).arrayBuffer()
      segments = await transcribeAudio(env.MISTRAL_API_KEY, audio, meeting.audio_key)
      repo.insertSegments(meeting.id, segments)
      repo.updateStatus(meeting.id, 'transcribed')
      msg.ack()
    catch err:
      repo.updateStatus(meeting.id, 'failed', String(err))
      msg.retry()   # max_retries (3) + dead_letter_queue handle the rest
```

---

## 10. Build order (what's left)

Nothing - we are done.

---

## 11. Known open items (flag back to the user, don't guess)

- Auth is purely done via Cloudflare Access on the domain of the deployed app. No auth is implemented in the codebase itself.
