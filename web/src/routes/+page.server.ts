import { NotesRepository } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const repo = new NotesRepository(platform!.env.DB);
	return { meetings: await repo.listMeetings() };
};
