import { error, json } from "@sveltejs/kit";
import { NotesRepository } from "$lib/server/db";
import type { RequestHandler } from "./$types";

// POST /api/meetings/:id/transcribe
// Enqueues { meetingId } to TRANSCRIBE_QUEUE (consumed by the consumer worker),
// sets status: queued, returns 202.
export const POST: RequestHandler = async ({ params, platform }) => {
  const env = platform!.env;
  const repo = new NotesRepository(env.DB);

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  await env.TRANSCRIBE_QUEUE.send({ meetingId: meeting.id });
  await repo.updateStatus(meeting.id, "queued");

  return json({ status: "queued" }, { status: 202 });
};
