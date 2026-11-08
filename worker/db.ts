import type { Block, Doc, Label, SyncPayload, Task } from '../shared/types';

const DEFAULT_LABELS: Label[] = [
  { id: 'work', name: 'Work', color: '#007AFF', on: true },
  { id: 'personal', name: 'Personal', color: '#34C759', on: true },
  { id: 'health', name: 'Health', color: '#FF9500', on: true },
  { id: 'learn', name: 'Learning', color: '#AF52DE', on: true }
];

const json = <T>(s: string | null | undefined, fallback: T): T => {
  try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};

export async function loadDoc(db: D1Database): Promise<Doc> {
  const seeded = await db.prepare(`SELECT value_json FROM meta WHERE key = 'seeded'`).first<{ value_json: string }>();
  if (!seeded) {
    const now = Date.now();
    await db.batch([
      ...DEFAULT_LABELS.map((l, i) =>
        db.prepare(`INSERT OR IGNORE INTO labels (id, name, color, is_on, sort, updated_at) VALUES (?, ?, ?, 1, ?, ?)`).bind(l.id, l.name, l.color, i, now)),
      db.prepare(`INSERT OR REPLACE INTO meta (key, value_json) VALUES ('seeded', 'true')`)
    ]);
  }

  const [labels, tasks, blocks, meta] = await db.batch([
    db.prepare(`SELECT * FROM labels ORDER BY sort, updated_at`),
    db.prepare(`SELECT * FROM tasks`),
    db.prepare(`SELECT * FROM blocks`),
    db.prepare(`SELECT * FROM meta`)
  ]);

  const m = Object.fromEntries((meta.results as { key: string; value_json: string }[]).map(r => [r.key, r.value_json]));
  const taskMap: Record<string, Task> = {};
  for (const r of tasks.results as any[]) {
    taskMap[r.id] = {
      id: r.id, title: r.title, labels: json(r.labels_json, []), desc: r.notes,
      links: json(r.links_json, []), done: !!r.done, doneDates: json(r.done_dates_json, {})
    };
  }
  return {
    labels: (labels.results as any[]).map(r => ({ id: r.id, name: r.name, color: r.color, on: !!r.is_on })),
    tasks: taskMap,
    blocks: (blocks.results as any[]).map((r): Block => ({
      id: r.id, date: r.date, start: r.start_min, end: r.end_min, title: r.title,
      repeat: !!r.is_repeat, tasks: json(r.task_ids_json, []), labels: json(r.labels_json, [])
    })),
    backlog: json<string[]>(m.backlog, []).filter(id => taskMap[id]),
    showUnlabeled: json(m.showUnlabeled, true)
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

export async function applySync(db: D1Database, p: SyncPayload): Promise<void> {
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const up = p.upsert ?? { labels: [], tasks: [], blocks: [] };
  const del = p.delete ?? { labels: [], tasks: [], blocks: [] };

  for (const l of up.labels ?? []) {
    if (!isStr(l.id) || !isStr(l.name) || !isStr(l.color)) continue;
    stmts.push(db.prepare(
      `INSERT INTO labels (id, name, color, is_on, sort, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET name = ?2, color = ?3, is_on = ?4, sort = ?5, updated_at = ?6`
    ).bind(l.id, l.name.slice(0, 200), l.color.slice(0, 32), l.on ? 1 : 0, isNum(l.sort) ? l.sort : 0, now));
  }
  for (const t of up.tasks ?? []) {
    if (!isStr(t.id)) continue;
    stmts.push(db.prepare(
      `INSERT INTO tasks (id, title, labels_json, notes, links_json, done, done_dates_json, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET title = ?2, labels_json = ?3, notes = ?4, links_json = ?5, done = ?6, done_dates_json = ?7, updated_at = ?8`
    ).bind(
      t.id, isStr(t.title) ? t.title : '', JSON.stringify(strArr(t.labels)), isStr(t.desc) ? t.desc : '',
      JSON.stringify(strArr(t.links)), t.done ? 1 : 0,
      JSON.stringify(t.doneDates && typeof t.doneDates === 'object' ? t.doneDates : {}), now
    ));
  }
  for (const b of up.blocks ?? []) {
    if (!isStr(b.id) || !isStr(b.date) || !isNum(b.start) || !isNum(b.end)) continue;
    stmts.push(db.prepare(
      `INSERT INTO blocks (id, date, start_min, end_min, title, is_repeat, task_ids_json, labels_json, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(id) DO UPDATE SET date = ?2, start_min = ?3, end_min = ?4, title = ?5, is_repeat = ?6, task_ids_json = ?7, labels_json = ?8, updated_at = ?9`
    ).bind(b.id, b.date, b.start, b.end, isStr(b.title) ? b.title : '', b.repeat ? 1 : 0, JSON.stringify(strArr(b.tasks)), JSON.stringify(strArr(b.labels)), now));
  }
  for (const id of strArr(del.labels)) stmts.push(db.prepare(`DELETE FROM labels WHERE id = ?`).bind(id));
  for (const id of strArr(del.tasks)) stmts.push(db.prepare(`DELETE FROM tasks WHERE id = ?`).bind(id));
  for (const id of strArr(del.blocks)) stmts.push(db.prepare(`DELETE FROM blocks WHERE id = ?`).bind(id));

  if (p.meta?.backlog) stmts.push(db.prepare(`INSERT OR REPLACE INTO meta (key, value_json) VALUES ('backlog', ?)`).bind(JSON.stringify(strArr(p.meta.backlog))));
  if (typeof p.meta?.showUnlabeled === 'boolean') stmts.push(db.prepare(`INSERT OR REPLACE INTO meta (key, value_json) VALUES ('showUnlabeled', ?)`).bind(JSON.stringify(p.meta.showUnlabeled)));

  if (stmts.length) await db.batch(stmts);
}

// --- login rate limiting ---
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

export async function isLockedOut(db: D1Database, ip: string): Promise<boolean> {
  const r = await db.prepare(`SELECT count, window_start FROM login_attempts WHERE ip = ?`).bind(ip).first<{ count: number; window_start: number }>();
  return !!r && Date.now() - r.window_start < WINDOW_MS && r.count >= MAX_FAILS;
}

export async function recordFailure(db: D1Database, ip: string): Promise<void> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO login_attempts (ip, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(ip) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`
  ).bind(ip, now, WINDOW_MS).run();
}

export async function clearFailures(db: D1Database, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}
