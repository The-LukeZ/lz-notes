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
