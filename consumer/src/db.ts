// Consumer-side NotesRepository. Intentionally duplicated from
// web/src/lib/server/db.ts rather than shared via a workspace package (the repo
// layout is two packages, not three — PLAN §3). This copy only implements the
// methods the consumer actually calls; overlapping signatures are kept
// identical to the web copy.

export type MeetingStatus =
	| 'uploaded'
	| 'queued'
	| 'transcribing'
	| 'transcribed'
	| 'notes_ready'
	| 'failed';

export interface Meeting {
	id: string;
	title: string;
	meeting_type: 'meeting' | 'learning';
	status: MeetingStatus;
	audio_key: string;
	error: string | null;
	created_at: string;
	updated_at: string;
}

export interface NewSegment {
	seq: number;
	speaker_label: string;
	speaker_name?: string | null;
	text: string;
	start_time?: number | null;
	end_time?: number | null;
}

export class NotesRepository {
	constructor(private db: D1Database) {}

	async getMeeting(id: string): Promise<Meeting | null> {
		const row = await this.db
			.prepare(`SELECT * FROM meetings WHERE id = ?`)
			.bind(id)
			.first<Meeting>();
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
