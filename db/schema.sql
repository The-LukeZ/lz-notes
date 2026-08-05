CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_type TEXT NOT NULL CHECK (meeting_type IN ('meeting', 'learning')),
  status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded -> queued -> transcribing -> transcribed -> notes_ready | failed
  audio_key TEXT NOT NULL,
  glossary TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  speaker_label TEXT NOT NULL,
  speaker_name TEXT,
  text TEXT NOT NULL,
  start_time REAL,
  end_time REAL
);
CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id);

CREATE TABLE IF NOT EXISTS notes (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
