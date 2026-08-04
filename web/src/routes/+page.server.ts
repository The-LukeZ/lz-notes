import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  return { meetings: await locals.db.listMeetings() };
};
