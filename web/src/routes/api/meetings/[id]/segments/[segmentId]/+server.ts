import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// PATCH /api/meetings/:id/segments/:segmentId
// Body: { text: string } -> 204
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const repo = locals.db;

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  if (!body || typeof body.text !== "string" || body.text.trim() === "") {
    throw error(400, "Expected { text: string }");
  }

  await repo.updateSegmentText(params.id, Number(params.segmentId), body.text);
  return new Response(null, { status: 204 });
};
