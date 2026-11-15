CREATE TABLE catalog_events (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  recorded_at INTEGER NOT NULL,
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  kind TEXT,
  source TEXT,
  observed_at INTEGER,
  author TEXT,
  stars INTEGER CHECK (stars IS NULL OR stars >= 0),
  views INTEGER CHECK (views IS NULL OR views >= 0),
  decision TEXT CHECK (decision IS NULL OR decision IN ('kept', 'dropped')),
  UNIQUE (stream, seq)
);
CREATE INDEX catalog_window ON catalog_events (observed_at, item_id, source) WHERE observed_at IS NOT NULL;
CREATE INDEX catalog_authors ON catalog_events (observed_at, author, item_id) WHERE author IS NOT NULL;
CREATE INDEX catalog_decisions ON catalog_events (item_id, seq DESC, decision) WHERE decision IS NOT NULL;
