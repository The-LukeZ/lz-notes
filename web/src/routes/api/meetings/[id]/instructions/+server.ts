import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// POST /api/meetings/:id/instructions
// Body: { instructions: string } -> 204
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const repo = locals.db;

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  const body = (await request.json().catch(() => null)) as { instructions?: string } | null;
  if (!body || typeof body.instructions !== "string") {
    throw error(400, "Expected { instructions: string }");
  }

  await repo.updateInstructions(params.id, body.instructions.trim() || null);
  return new Response(null, { status: 204 });
};
