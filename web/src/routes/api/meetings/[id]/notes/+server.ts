// @ts-expect-error: Somehow this isnt found because of Sveltekit shenanigans
import { env } from "$env/dynamic/private";
import { error, json } from "@sveltejs/kit";
import { generateNotes } from "$lib/server/mistral";
import { buildTranscriptText, systemPromptFor } from "$lib/server/templates";

// POST /api/meetings/:id/notes
// Builds the transcript text from stored segments, picks the prompt by
// meeting_type, calls Mistral chat completions, stores + returns the markdown.
export const POST = async ({ params, locals }) => {
  const repo = locals.db;

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  const segments = await repo.getSegments(params.id);
  if (segments.length === 0) {
    throw error(409, "No transcript segments yet — transcribe the meeting first");
  }

  if (!env.MISTRAL_API_KEY) throw error(500, "MISTRAL_API_KEY is not configured");

  const transcript = buildTranscriptText(segments);
  const systemPrompt = systemPromptFor(meeting.meeting_type);
  const markdown = await generateNotes(env.MISTRAL_API_KEY, systemPrompt, transcript);

  await repo.saveNotes(params.id, markdown);
  return json({ markdown });
};
