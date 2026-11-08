CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_on INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  labels_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  links_json TEXT NOT NULL DEFAULT '[]',
  done INTEGER NOT NULL DEFAULT 0,
  done_dates_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  is_repeat INTEGER NOT NULL DEFAULT 0,
  task_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE INDEX blocks_date ON blocks(date);
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
