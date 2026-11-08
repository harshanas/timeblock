export interface Label { id: string; name: string; color: string; on: boolean }
export interface Task {
  id: string; title: string; labels: string[]; desc: string; links: string[];
  done: boolean; doneDates: Record<string, boolean>;
}
/** When a repeating block stops: on a last date (inclusive), or after N occurrences counted from the block's date. */
export type RepeatEnd = { type: 'until'; date: string } | { type: 'count'; count: number };
export interface Block {
  id: string; date: string; start: number; end: number; title: string; repeat: boolean; tasks: string[];
  /** Labels set on the block itself (in addition to its tasks' labels). */
  labels: string[];
  /** Weekdays (0 = Sun … 6 = Sat) a repeating block occurs on. */
  repeatDays: number[];
  /** null = repeats forever. */
  repeatEnd: RepeatEnd | null;
}
export interface Doc {
  tasks: Record<string, Task>;
  blocks: Block[];
  backlog: string[];
  labels: Label[];
  showUnlabeled: boolean;
}
export interface SyncPayload {
  upsert: { labels: (Label & { sort: number })[]; tasks: Task[]; blocks: Block[] };
  delete: { labels: string[]; tasks: string[]; blocks: string[] };
  meta?: { backlog?: string[]; showUnlabeled?: boolean };
}
