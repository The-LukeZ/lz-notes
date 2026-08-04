import type { NewSegment } from "./db";

// Transcription + diarization via Mistral voxtral-mini-latest (PLAN §1).
//
// ⚠️ UNVERIFIED RESPONSE SHAPE — READ PLAN §1 / §10 STEP 3 BEFORE TRUSTING THIS.
// The exact JSON shape of the diarized response (field names for speaker label /
// text / start / end per segment) was NOT confirmed against a real response
// during planning. `parseTranscriptionResponse` below is a best-guess parser
// that assumes an OpenAI-style `{ segments: [{ speaker, text, start, end }] }`
// shape. It logs the raw response and throws clearly if the shape doesn't match,
// rather than silently producing garbage. Make one real test call against a
// short multi-speaker clip (via `wrangler tail` on a test run, or a standalone
// curl), inspect the actual JSON, and fix the field names here before relying
// on it.

const TRANSCRIPTIONS_URL = "https://api.mistral.ai/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "voxtral-mini-latest";

export async function transcribeAudio(
  apiKey: string,
  audio: ArrayBuffer,
  audioKey: string
): Promise<NewSegment[]> {
  const filename = audioKey.split("/").pop() || "recording";

  const form = new FormData();
  form.set("model", TRANSCRIBE_MODEL);
  form.set("file", new File([audio], filename));
  form.set("diarize", "true");
  form.set("timestamp_granularities", "segment");

  const res = await fetch(TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mistral transcription failed (${res.status}): ${body}`);
  }

  const data: unknown = await res.json();
  return parseTranscriptionResponse(data);
}

// Best-guess parser — see the ⚠️ warning at the top of this file.
export function parseTranscriptionResponse(data: unknown): NewSegment[] {
  // Log the raw response so the actual shape is inspectable via `wrangler tail`.
  console.log("Mistral transcription raw response:", JSON.stringify(data));

  if (typeof data !== "object" || data === null) {
    throw new Error(`Unexpected transcription response (not an object): ${JSON.stringify(data)}`);
  }

  const segmentsRaw = (data as { segments?: unknown }).segments;
  if (!Array.isArray(segmentsRaw)) {
    throw new Error(
      `Transcription response has no "segments" array — the response shape does ` +
        `not match the best-guess parser. Inspect the logged raw response and fix ` +
        `parseTranscriptionResponse(). Raw: ${JSON.stringify(data)}`
    );
  }

  return segmentsRaw.map((seg, index): NewSegment => {
    if (typeof seg !== "object" || seg === null) {
      throw new Error(`Segment ${index} is not an object: ${JSON.stringify(seg)}`);
    }
    const s = seg as Record<string, unknown>;

    const text = s.text;
    if (typeof text !== "string") {
      throw new Error(
        `Segment ${index} has no string "text" field — shape mismatch. ` +
          `Raw segment: ${JSON.stringify(seg)}`
      );
    }

    return {
      seq: index,
      speaker_label: normalizeSpeaker(s.speaker, index),
      text,
      start_time: toNumber(s.start),
      end_time: toNumber(s.end),
    };
  });
}

function normalizeSpeaker(value: unknown, index: number): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return `SPEAKER_${String(value).padStart(2, "0")}`;
  // No usable speaker label on this segment — fall back so we never store an
  // empty NOT NULL column. If this fires a lot, the field name is wrong.
  console.warn(`Segment ${index} missing speaker label; defaulting to SPEAKER_UNKNOWN`);
  return "SPEAKER_UNKNOWN";
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
