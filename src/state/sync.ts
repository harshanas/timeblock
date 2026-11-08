import type { Doc, SyncPayload } from '../../shared/types';
import { api, HttpError } from '../api';

export type SyncStatus = 'saved' | 'saving' | 'error' | 'unauthorized';

/**
 * Online-only sync: diffs the current document against the last state the server
 * confirmed (by object reference — all updates are immutable) and posts the changes.
 */
export class Syncer {
  private confirmed: Doc;
  private latest: Doc;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  status: SyncStatus = 'saved';

  constructor(initial: Doc, private onStatus: (s: SyncStatus) => void) {
    this.confirmed = initial;
    this.latest = initial;
    window.addEventListener('online', this.flushNow);
    window.addEventListener('pagehide', this.flushKeepalive);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  dispose() {
    window.removeEventListener('online', this.flushNow);
    window.removeEventListener('pagehide', this.flushKeepalive);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  /** Replace the baseline (e.g. after re-fetching from the server). */
  reset(doc: Doc) { this.confirmed = doc; this.latest = doc; }

  get dirty() { return this.inFlight || diff(this.confirmed, this.latest) !== null; }

  push(doc: Doc) {
    this.latest = doc;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.flushNow, 400);
  }

  private setStatus(s: SyncStatus) { if (s !== this.status) { this.status = s; this.onStatus(s); } }

  private onVisibility = () => { if (document.visibilityState === 'hidden') this.flushKeepalive(); };

  private flushKeepalive = () => {
    if (this.inFlight) return;
    const target = this.latest, p = diff(this.confirmed, target);
    if (!p) return;
    api.sync(p, true).then(() => { this.confirmed = target; }).catch(() => {});
  };

  flushNow = async () => {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.inFlight) return;
    const target = this.latest, p = diff(this.confirmed, target);
    if (!p) { if (this.status !== 'unauthorized') this.setStatus('saved'); return; }
    this.inFlight = true;
    this.setStatus('saving');
    try {
      await api.sync(p);
      this.confirmed = target;
      this.inFlight = false;
      if (this.latest !== target) this.flushNow();
      else this.setStatus('saved');
    } catch (e) {
      this.inFlight = false;
      if (e instanceof HttpError && e.status === 401) { this.setStatus('unauthorized'); return; }
      this.setStatus('error');
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(this.flushNow, 10000);
    }
  };
}

export function diff(a: Doc, b: Doc): SyncPayload | null {
  const p: SyncPayload = { upsert: { labels: [], tasks: [], blocks: [] }, delete: { labels: [], tasks: [], blocks: [] }, meta: {} };
  let n = 0;

  for (const id in b.tasks) if (a.tasks[id] !== b.tasks[id]) { p.upsert.tasks.push(b.tasks[id]); n++; }
  for (const id in a.tasks) if (!b.tasks[id]) { p.delete.tasks.push(id); n++; }

  const aBlocks = new Map(a.blocks.map(x => [x.id, x]));
  const bIds = new Set<string>();
  for (const blk of b.blocks) { bIds.add(blk.id); if (aBlocks.get(blk.id) !== blk) { p.upsert.blocks.push(blk); n++; } }
  for (const id of aBlocks.keys()) if (!bIds.has(id)) { p.delete.blocks.push(id); n++; }

  const aLabelIdx = new Map(a.labels.map((x, i) => [x.id, { x, i }]));
  const bLabelIds = new Set<string>();
  b.labels.forEach((l, i) => {
    bLabelIds.add(l.id);
    const prev = aLabelIdx.get(l.id);
    if (!prev || prev.x !== l || prev.i !== i) { p.upsert.labels.push({ ...l, sort: i }); n++; }
  });
  for (const id of aLabelIdx.keys()) if (!bLabelIds.has(id)) { p.delete.labels.push(id); n++; }

  if (a.backlog !== b.backlog) { p.meta!.backlog = b.backlog; n++; }
  if (a.showUnlabeled !== b.showUnlabeled) { p.meta!.showUnlabeled = b.showUnlabeled; n++; }

  return n ? p : null;
}
