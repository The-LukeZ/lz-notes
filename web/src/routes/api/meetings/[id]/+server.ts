import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// GET /api/meetings/:id -> { meeting, segments, notes }
export const GET: RequestHandler = async ({ params, locals }) => {
  const repo = locals.db;

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  const [segments, notes] = await Promise.all([repo.getSegments(params.id), repo.getNotes(params.id)]);

  return json({ meeting, segments, notes });
};

// DELETE /api/meetings/:id -> 204
// Removes the D1 row (cascades to segments/notes via FK) and best-effort
// deletes the R2 audio object (may already be gone if the consumer cleaned
// it up after transcription).
export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
  const repo = locals.db;

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  try {
    await platform!.env.AUDIO_BUCKET.delete(meeting.audio_key);
  } catch (err) {
    console.error(`[web] failed to delete audio meeting=${meeting.id}:`, err);
  }

  await repo.deleteMeeting(params.id);
  return new Response(null, { status: 204 });
};
