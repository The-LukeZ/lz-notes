import { error, json } from "@sveltejs/kit";
import { NotesRepository } from "$lib/server/db";
import type { MeetingType } from "$lib/server/types";
import type { RequestHandler } from "./$types";

// POST /api/meetings
// multipart/form-data: file (audio), title, meetingType ('meeting' | 'learning')
// Creates the D1 row (status: uploaded) and streams the file into R2 at
// key `audio/{id}/{filename}`.
export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  const form = await request.formData();

  const file = form.get("file");
  const title = form.get("title");
  const meetingType = form.get("meetingType");

  if (!(file instanceof File)) throw error(400, "Missing audio file");
  if (typeof title !== "string" || title.trim() === "") throw error(400, "Missing title");
  if (meetingType !== "meeting" && meetingType !== "learning") {
    throw error(400, "meetingType must be 'meeting' or 'learning'");
  }

  const id = crypto.randomUUID();
  const filename = file.name || "recording";
  const audioKey = `audio/${id}/${filename}`;

  await env.AUDIO_BUCKET.put(audioKey, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const repo = new NotesRepository(env.DB);
  await repo.createMeeting({
    id,
    title: title.trim(),
    meetingType: meetingType as MeetingType,
    audioKey,
  });

  return json({ id }, { status: 201 });
};
