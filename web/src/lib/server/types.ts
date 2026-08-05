// Shared domain types for the web worker. These mirror the D1 schema in
// db/schema.sql. When Drizzle lands (see PLAN §3) these should become the
// inferred row types from the Drizzle schema, but the shapes shouldn't change.

export type MeetingType = "meeting" | "learning";

export type MeetingStatus = "uploaded" | "queued" | "transcribing" | "transcribed" | "notes_ready" | "failed";

export interface Meeting {
  id: string;
  title: string;
  meeting_type: MeetingType;
  status: MeetingStatus;
  audio_key: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Segment {
  id: number;
  meeting_id: string;
  seq: number;
  speaker_label: string;
  speaker_name: string | null;
  text: string;
  start_time: number | null;
  end_time: number | null;
}

// A segment as produced by the transcription parser, before it has a DB id.
export interface NewSegment {
  seq: number;
  speaker_label: string;
  speaker_name?: string | null;
  text: string;
  start_time?: number | null;
  end_time?: number | null;
}
