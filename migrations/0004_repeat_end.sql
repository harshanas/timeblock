-- When a repeating block stops: {"type":"until","date":"YYYY-MM-DD"}, {"type":"count","count":N}, or NULL for never.
ALTER TABLE blocks ADD COLUMN repeat_end_json TEXT;
