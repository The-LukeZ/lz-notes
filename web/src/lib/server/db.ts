import type { Meeting, MeetingStatus, MeetingType, NewSegment, Segment } from "./types";

// All D1 access for the web worker goes through this class (PLAN §3). No route
// handler should ever call `.prepare()` / `.batch()` on the D1Database directly.
// The consumer worker has its own copy (consumer/src/db.ts) implementing the
// subset of methods it needs; keep overlapping signatures identical between the
// two. When Drizzle lands, only the constructor and method bodies change — the
// public signatures stay put, so nothing calling the repository has to change.
export class NotesRepository {
  constructor(private db: D1Database) {}

  // --- web only ---------------------------------------------------------

  async createMeeting(params: {
    id: string;
    title: string;
    meetingType: MeetingType;
    audioKey: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO meetings (id, title, meeting_type, status, audio_key)
				 VALUES (?, ?, ?, 'uploaded', ?)`
      )
      .bind(params.id, params.title, params.meetingType, params.audioKey)
      .run();
  }

  async listMeetings(): Promise<Meeting[]> {
    const result = await this.db.prepare(`SELECT * FROM meetings ORDER BY created_at DESC`).run<Meeting>();

    console.log("listMeetings", { success: result.success, results: result.results });
    return result.results ?? [];
  }

  async getSegments(meetingId: string): Promise<Segment[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY seq ASC`)
      .bind(meetingId)
      .run<Segment>();
    return results ?? [];
  }

  async updateSpeakerNames(meetingId: string, mapping: Record<string, string>): Promise<void> {
    const entries = Object.entries(mapping);
    if (entries.length === 0) return;

    const statements = entries.map(([label, name]) =>
      this.db
        .prepare(
          `UPDATE transcript_segments SET speaker_name = ?
					 WHERE meeting_id = ? AND speaker_label = ?`
        )
        .bind(name, meetingId, label)
    );
    await this.db.batch(statements);
  }

  async saveNotes(meetingId: string, markdown: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO notes (meeting_id, markdown) VALUES (?, ?)
					 ON CONFLICT(meeting_id) DO UPDATE SET markdown = excluded.markdown`
        )
        .bind(meetingId, markdown),
      this.db
        .prepare(
          `UPDATE meetings SET status = 'notes_ready', updated_at = datetime('now')
					 WHERE id = ?`
        )
        .bind(meetingId),
    ]);
  }

  async getNotes(meetingId: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT markdown FROM notes WHERE meeting_id = ?`)
      .bind(meetingId)
      .first<{ markdown: string }>();
    return row?.markdown ?? null;
  }

  // --- both web and consumer -------------------------------------------

  async getMeeting(id: string): Promise<Meeting | null> {
    const row = await this.db.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(id).first<Meeting>();
    return row ?? null;
  }

  async updateStatus(id: string, status: MeetingStatus, error?: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE meetings SET status = ?, error = ?, updated_at = datetime('now')
				 WHERE id = ?`
      )
      .bind(status, error ?? null, id)
      .run();
  }

  async insertSegments(meetingId: string, segments: NewSegment[]): Promise<void> {
    if (segments.length === 0) return;

    const statements = segments.map((s) =>
      this.db
        .prepare(
          `INSERT INTO transcript_segments
					 (meeting_id, seq, speaker_label, speaker_name, text, start_time, end_time)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          meetingId,
          s.seq,
          s.speaker_label,
          s.speaker_name ?? null,
          s.text,
          s.start_time ?? null,
          s.end_time ?? null
        )
    );
    await this.db.batch(statements);
  }
}
