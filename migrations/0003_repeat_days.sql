-- Weekdays (0 = Sunday … 6 = Saturday) a repeating block occurs on.
ALTER TABLE blocks ADD COLUMN repeat_days_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]';
