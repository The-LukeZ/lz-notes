import { error } from "@sveltejs/kit";
import { NotesRepository } from "$lib/server/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, platform }) => {
  const repo = new NotesRepository(platform!.env.DB);

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  const [segments, notes] = await Promise.all([repo.getSegments(params.id), repo.getNotes(params.id)]);

  return { meeting, segments, notes };
};
