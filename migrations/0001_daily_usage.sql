CREATE TABLE IF NOT EXISTS daily_usage (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  tool TEXT NOT NULL,
  channel TEXT NOT NULL,
  mode TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, tool, channel, mode)
) WITHOUT ROWID;
