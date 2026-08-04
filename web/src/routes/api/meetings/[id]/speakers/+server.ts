import { error } from "@sveltejs/kit";
import { NotesRepository } from "$lib/server/db";
import type { RequestHandler } from "./$types";

// POST /api/meetings/:id/speakers
// Body: { mapping: { "SPEAKER_00": "Maria", ... } } -> 204
export const POST: RequestHandler = async ({ params, request, platform }) => {
  const repo = new NotesRepository(platform!.env.DB);

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  const body = (await request.json().catch(() => null)) as {
    mapping?: Record<string, string>;
  } | null;
  if (!body || typeof body.mapping !== "object" || body.mapping === null) {
    throw error(400, "Expected { mapping: Record<string, string> }");
  }

  await repo.updateSpeakerNames(params.id, body.mapping);
  return new Response(null, { status: 204 });
};
