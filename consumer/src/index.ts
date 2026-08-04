import { NotesRepository } from "./db";
import { transcribeAudio } from "./mistral";
import type { TranscribeBatch, TranscribeJob } from "./env";
// `Env` is a global from the wrangler-generated worker-configuration.d.ts.

// Queue consumer worker (PLAN §9). No frontend — this only does the long-running
// transcription call and writes results to D1. Workers CPU-time limits count
// active compute, not time spent awaiting fetch(), so idle-waiting on Mistral is
// cheap here (PLAN §1).
export default {
  fetch(_request, _env, _ctx) {
    return new Response("lz-notes consumer worker");
  },
  async queue(batch: TranscribeBatch, env: Env): Promise<void> {
    const repo = new NotesRepository(env.DB);

    for (const msg of batch.messages) {
      const { meetingId } = msg.body;
      console.log(`[consumer] job start meeting=${meetingId}`);
      const meeting = await repo.getMeeting(meetingId);

      // Deleted mid-flight — nothing to do, drop the message.
      if (!meeting) {
        console.log(`[consumer] meeting not found, dropping meeting=${meetingId}`);
        msg.ack();
        continue;
      }

      try {
        await repo.updateStatus(meeting.id, "transcribing");
        console.log(`[consumer] fetching audio meeting=${meeting.id} key=${meeting.audio_key}`);

        const object = await env.AUDIO_BUCKET.get(meeting.audio_key);
        if (!object) throw new Error(`Audio object not found: ${meeting.audio_key}`);
        const audio = await object.arrayBuffer();
        console.log(`[consumer] audio fetched meeting=${meeting.id} bytes=${audio.byteLength}, calling mistral`);

        const segments = await transcribeAudio(env.MISTRAL_API_KEY, audio, meeting.audio_key);
        console.log(`[consumer] transcription done meeting=${meeting.id} segments=${segments.length}`);
        await repo.insertSegments(meeting.id, segments);
        await repo.updateStatus(meeting.id, "transcribed");
        console.log(`[consumer] job done meeting=${meeting.id}`);

        msg.ack();
      } catch (err) {
        console.error(`[consumer] job failed meeting=${meeting.id}:`, err);
        await repo.updateStatus(meeting.id, "failed", String(err));
        // max_retries (3) + dead_letter_queue handle the rest.
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, TranscribeJob>;
