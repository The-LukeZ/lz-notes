import { error, json } from '@sveltejs/kit';
import { NotesRepository } from '$lib/server/db';
import type { RequestHandler } from './$types';

// GET /api/meetings/:id/status -> { status, error } — for client polling.
export const GET: RequestHandler = async ({ params, platform }) => {
	const repo = new NotesRepository(platform!.env.DB);

	const meeting = await repo.getMeeting(params.id);
	if (!meeting) throw error(404, 'Meeting not found');

	return json({ status: meeting.status, error: meeting.error });
};
