// Port of ui/Timeblock Todos.dc.html. Logic mirrors the prototype's Component class; markup and
// inline styles are copied from the design. Phone (<768px) adaptations are marked "mobile".
import React from 'react';
import type { Block, Doc, Label, Task } from '../../shared/types';
import { BLOCK_STYLE, HOUR_HEIGHT, MOBILE_BREAKPOINT, WEEK_STARTS_ON } from '../config';
import { api } from '../api';
import { Syncer, type SyncStatus } from '../state/sync';
import { ALL_DAYS, COLORS, DOW, DOWL, MONTHS, dayOrder, daysSummary, endSummary, occursOn, repeatLastDate, shortDate, addDays, clamp, darken, ds, fmtT, hexA, hm, parse, snap, uid } from '../lib/util';

type Sel = { kind: 'block'; id: string; date: string } | { kind: 'task'; id: string } | null;
type Preview =
  | { kind: 'create'; date: string; start: number; end: number; title?: string }
  | { kind: 'block'; id: string; date: string; start: number; end: number }
  | null;

interface State extends Doc {
  viewStart: string | null;
  sel: Sel;
  expanded: string | null;
  preview: Preview;
  taskDraft: string; backlogDraft: string; labelDraft: string; linkDraft: string;
  now: Date;
  isMobile: boolean; mobileDays: 1 | 3; drawerOpen: boolean;
  syncStatus: SyncStatus;
  schedDate: string; schedTime: string; schedTarget: string;
  undo: { id: number; text: string; restore: () => void } | null;
  editingLabel: string | null; labelEditDraft: string;
  chipDraft: string | null; chipOwner: string | null;
  colorPicker: string | null;
}

interface Props { initial: Doc; onUnauthorized: () => void; onLogout: () => void }

interface Drag {
  mode: 'create' | 'move' | 'resize';
  x0: number; y0: number; lastX: number; lastY: number;
  moved?: boolean; armed: boolean; timer?: ReturnType<typeof setTimeout>;
  day?: number; anchor?: number;
  id?: string; repeat?: boolean; date?: string; occDate?: string; start?: number; end?: number;
}

const DOC_KEYS = ['tasks', 'blocks', 'backlog', 'labels', 'showUnlabeled'] as const;
const MONDAY_FIRST = WEEK_STARTS_ON === 'Monday';
const normBlock = (b: Block): Block => ({ ...b, labels: b.labels ?? [], repeatDays: b.repeatDays?.length ? b.repeatDays : ALL_DAYS, repeatEnd: b.repeatEnd ?? null });
const mq = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

const Check = ({ size = 9 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 10 10"><path d="M2 5.2 4.2 7.3 8 2.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const RepeatIcon = ({ size, stroke, sw = 1.5 }: { size: number; stroke: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}><path d="M2 6.5a5 5 0 0 1 8.6-3.4M12 7.5a5 5 0 0 1-8.6 3.4M10.8 1v2.4H8.4M3.2 13v-2.4h2.4" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Toggle = ({ on, onClick, w = 34, h = 20 }: { on: boolean; onClick: () => void; w?: number; h?: number }) => {
  const k = h - 4;
  return (
    <div role="switch" aria-checked={on} onClick={onClick} style={{ width: w, height: h, borderRadius: h / 2, background: on ? '#34C759' : 'rgba(120,120,128,0.24)', position: 'relative', transition: 'background .2s', cursor: 'pointer', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: on ? w - k - 2 : 2, width: k, height: k, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .2s' }} />
    </div>
  );
};

export default class Planner extends React.Component<Props, State> {
  scrollRef = React.createRef<HTMLDivElement>();
  colsRef = React.createRef<HTMLDivElement>();
  titleRef = React.createRef<HTMLInputElement>();
  labelInputRef = React.createRef<HTMLInputElement>();
  undoTimer?: ReturnType<typeof setTimeout>;
  drag: Drag | null = null;
  dragTask: string | null = null;
  wantFocus = false;
  syncer!: Syncer;
  tick?: ReturnType<typeof setInterval>;
  mv?: (e: PointerEvent) => void;
  up?: (e: PointerEvent) => void;
  cancel?: (e: PointerEvent) => void;
  mql = mq();

  constructor(props: Props) {
    super(props);
    const now = new Date();
    this.state = {
      ...props.initial,
      blocks: props.initial.blocks.map(normBlock),
      viewStart: null, sel: null, expanded: null, preview: null,
      taskDraft: '', backlogDraft: '', labelDraft: '', linkDraft: '', now,
      isMobile: this.mql.matches, mobileDays: 1, drawerOpen: false, syncStatus: 'saved',
      schedDate: ds(now), schedTime: '09:00', schedTarget: 'new',
      undo: null, editingLabel: null, labelEditDraft: '', chipDraft: null, chipOwner: null, colorPicker: null
    };
  }

  docOf(s: State = this.state): Doc {
    return { tasks: s.tasks, blocks: s.blocks, backlog: s.backlog, labels: s.labels, showUnlabeled: s.showUnlabeled };
  }

  hh() { return HOUR_HEIGHT; }
  nDays() { return this.state.isMobile ? this.state.mobileDays : 7; }
  viewStartDate() {
    const S = this.state;
    if (S.isMobile) return S.viewStart ?? ds(S.now);
    const d = S.viewStart ? parse(S.viewStart) : new Date(S.now);
    const mon = WEEK_STARTS_ON === 'Monday';
    d.setDate(d.getDate() - ((d.getDay() - (mon ? 1 : 0) + 7) % 7));
    return ds(d);
  }

  onMql = () => this.setState({ isMobile: this.mql.matches, drawerOpen: false });
  onTouchMove = (e: TouchEvent) => { if (this.drag && this.drag.armed) e.preventDefault(); };
  onKey = (e: KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    const tag = (el && el.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'Escape' && this.state.colorPicker) { this.setState({ colorPicker: null }); return; }
    if (e.key === 'Escape') { if (typing) el!.blur(); else this.setState({ sel: null, expanded: null, drawerOpen: false }); }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !typing && this.state.sel && this.state.sel.kind === 'block') { e.preventDefault(); this.deleteBlock(this.state.sel.id); }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !typing && this.state.sel && this.state.sel.kind === 'task') { e.preventDefault(); this.deleteTask(this.state.sel.id); }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && this.state.undo) { e.preventDefault(); this.runUndo(); }
  };
  onVisible = async () => {
    if (document.visibilityState !== 'visible') return;
    this.setState({ now: new Date() });
    // Pick up edits made on other devices, unless we have unsaved changes or a drag is in progress.
    if (this.syncer.dirty || this.drag) return;
    try {
      const doc = await api.state();
      if (this.syncer.dirty || this.drag) return;
      const norm = { ...doc, blocks: doc.blocks.map(normBlock) };
      this.syncer.reset(norm);
      this.setState({ ...norm });
    } catch { /* ignore; next save will surface errors */ }
  };

  componentDidMount() {
    this.syncer = new Syncer(this.docOf(), s => {
      this.setState({ syncStatus: s });
      if (s === 'unauthorized') this.props.onUnauthorized();
    });
    if (this.scrollRef.current) {
      this.scrollRef.current.scrollTop = 7 * this.hh() - 8;
      this.scrollRef.current.addEventListener('touchmove', this.onTouchMove, { passive: false });
    }
    this.tick = setInterval(() => this.setState({ now: new Date() }), 60000);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisible);
    this.mql.addEventListener('change', this.onMql);
  }
  componentWillUnmount() {
    clearInterval(this.tick);
    clearTimeout(this.undoTimer);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.mql.removeEventListener('change', this.onMql);
    this.scrollRef.current?.removeEventListener('touchmove', this.onTouchMove);
    this.endDrag();
    this.syncer.flushNow();
    this.syncer.dispose();
  }
  componentDidUpdate(_pp: Props, ps: State) {
    const S = this.state;
    if (DOC_KEYS.some(k => ps[k] !== S[k])) this.syncer.push(this.docOf());
    if (this.wantFocus && this.titleRef.current) { this.wantFocus = false; this.titleRef.current.focus(); this.titleRef.current.select(); }
  }

  updTask(id: string, patch: Partial<Task>) { this.setState(s => ({ tasks: { ...s.tasks, [id]: { ...s.tasks[id], ...patch } } })); }
  updBlock(id: string, patch: Partial<Block>) { this.setState(s => ({ blocks: s.blocks.map(b => b.id === id ? { ...b, ...patch } : b) })); }
  isDone(t: Task, b: Block | null, date: string | null) { return b && b.repeat ? !!(t.doneDates || {})[date!] : !!t.done; }
  toggleDone(t: Task, b: Block | null, date: string | null) {
    if (b && b.repeat) this.updTask(t.id, { doneDates: { ...(t.doneDates || {}), [date!]: !(t.doneDates || {})[date!] } });
    else this.updTask(t.id, { done: !t.done });
  }
  newTask(title: string): Task { return { id: uid(), title, labels: [], desc: '', links: [], done: false, doneDates: {} }; }

  showUndo(text: string, restore: () => void) {
    clearTimeout(this.undoTimer);
    const id = Date.now();
    this.setState({ undo: { id, text, restore } });
    this.undoTimer = setTimeout(() => { if (this.state.undo?.id === id) this.setState({ undo: null }); }, 8000);
  }
  runUndo = () => { const u = this.state.undo; if (!u) return; clearTimeout(this.undoTimer); this.setState({ undo: null }); u.restore(); };

  deleteTask(tid: string) {
    const s0 = this.state, t = s0.tasks[tid]; if (!t) return;
    const backIdx = s0.backlog.indexOf(tid);
    const where = s0.blocks.filter(b => b.tasks.includes(tid)).map(b => ({ id: b.id, idx: b.tasks.indexOf(tid) }));
    this.setState(s => {
      const tasks = { ...s.tasks }; delete tasks[tid];
      const sel = s.sel && s.sel.kind === 'task' && s.sel.id === tid ? null : s.sel;
      return { tasks, sel, expanded: s.expanded === tid ? null : s.expanded, backlog: s.backlog.filter(x => x !== tid), blocks: s.blocks.map(x => x.tasks.includes(tid) ? { ...x, tasks: x.tasks.filter(y => y !== tid) } : x) };
    });
    this.showUndo(`Deleted “${t.title || 'Untitled'}”`, () => this.setState(s => {
      if (s.tasks[tid]) return null;
      let placed = false;
      const blocks = s.blocks.map(b => {
        const m = where.find(x => x.id === b.id); if (!m) return b;
        placed = true; const ts = [...b.tasks]; ts.splice(Math.min(m.idx, ts.length), 0, tid); return { ...b, tasks: ts };
      });
      let backlog = s.backlog;
      if (backIdx >= 0 || !placed) { const i = Math.max(0, Math.min(backIdx, backlog.length)); backlog = [...backlog.slice(0, i), tid, ...backlog.slice(i)]; }
      return { tasks: { ...s.tasks, [tid]: t }, blocks, backlog };
    }));
  }

  /** Creates a label (or reuses one with the same name) and returns its id. */
  addLabel(name: string): string {
    const existing = this.state.labels.find(l => l.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const id = uid();
    this.setState(s => {
      const used = new Set(s.labels.map(l => l.color));
      const color = COLORS.find(c => !used.has(c)) || COLORS[s.labels.length % COLORS.length];
      return { labels: [...s.labels, { id, name, color, on: true }] };
    });
    return id;
  }

  deleteLabel(id: string) {
    const s0 = this.state, idx = s0.labels.findIndex(l => l.id === id), label = s0.labels[idx];
    if (!label) return;
    const tids = Object.values(s0.tasks).filter(t => t.labels.includes(id)).map(t => t.id);
    const bids = new Set(s0.blocks.filter(b => b.labels.includes(id)).map(b => b.id));
    this.setState(s => {
      const tasks = { ...s.tasks };
      for (const tid of tids) if (tasks[tid]) tasks[tid] = { ...tasks[tid], labels: tasks[tid].labels.filter(x => x !== id) };
      const blocks = s.blocks.map(b => b.labels.includes(id) ? { ...b, labels: b.labels.filter(x => x !== id) } : b);
      return { labels: s.labels.filter(l => l.id !== id), tasks, blocks, editingLabel: null };
    });
    this.showUndo(`Deleted label “${label.name}”`, () => this.setState(s => {
      if (s.labels.some(l => l.id === id)) return null;
      const labels = [...s.labels]; labels.splice(Math.min(idx, labels.length), 0, label);
      const tasks = { ...s.tasks };
      for (const tid of tids) if (tasks[tid] && !tasks[tid].labels.includes(id)) tasks[tid] = { ...tasks[tid], labels: [...tasks[tid].labels, id] };
      const blocks = s.blocks.map(b => bids.has(b.id) && !b.labels.includes(id) ? { ...b, labels: [...b.labels, id] } : b);
      return { labels, tasks, blocks };
    }));
  }

  commitLabelEdit() {
    const S = this.state, id = S.editingLabel, name = S.labelEditDraft.trim();
    if (!id) return;
    this.setState(s => ({ editingLabel: null, labels: name ? s.labels.map(l => l.id === id ? (l.name === name ? l : { ...l, name }) : l) : s.labels }));
  }

  createBlock(date: string, start: number, end: number, extra: Partial<Block> = {}) {
    const b: Block = { id: uid(), date, start, end, title: 'New Block', repeat: false, tasks: [], labels: [], repeatDays: ALL_DAYS, repeatEnd: null, ...extra };
    this.wantFocus = !extra.tasks && !this.state.isMobile;
    this.setState(s => ({ blocks: [...s.blocks, b], sel: { kind: 'block', id: b.id, date }, expanded: null, preview: null, drawerOpen: false }));
    return b;
  }
  deleteBlock(id: string) {
    this.setState(s => {
      const b = s.blocks.find(x => x.id === id); if (!b) return null;
      const tasks = { ...s.tasks }, back: string[] = [];
      b.tasks.forEach(tid => { const t = tasks[tid]; if (!t) return; if (!b.repeat && t.done) delete tasks[tid]; else back.push(tid); });
      return { blocks: s.blocks.filter(x => x.id !== id), tasks, backlog: [...back, ...s.backlog], sel: null, expanded: null };
    });
  }
  scheduleTask(tid: string, blockId: string) {
    this.setState(s => {
      const blocks = s.blocks.map(b => {
        const t = b.tasks.filter(x => x !== tid);
        return b.id === blockId ? { ...b, tasks: [...t, tid] } : (t.length !== b.tasks.length ? { ...b, tasks: t } : b);
      });
      return { blocks, backlog: s.backlog.filter(x => x !== tid), preview: null, sel: s.sel && s.sel.kind === 'task' && s.sel.id === tid ? null : s.sel };
    });
  }

  // geometry
  minFromY(y: number, floor?: boolean) { const r = this.colsRef.current!.getBoundingClientRect(); const m = (y - r.top) / this.hh() * 60; return clamp(floor ? Math.floor(m / 15) * 15 : snap(m), 0, 1440); }
  dayFromX(x: number) { const n = this.nDays(); const r = this.colsRef.current!.getBoundingClientRect(); return clamp(Math.floor((x - r.left) / (r.width / n)), 0, n - 1); }

  startDrag(e: React.PointerEvent, mode: Drag['mode'], b?: Block, occDate?: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (this.drag) this.cancelDrag();
    // mobile: touch needs a long-press before moving/creating so a normal swipe still scrolls.
    const armed = e.pointerType !== 'touch' || mode === 'resize';
    const base = { x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, armed };
    if (mode === 'create') this.drag = { mode, day: this.dayFromX(e.clientX), anchor: this.minFromY(e.clientY, true), ...base };
    else this.drag = { mode, id: b!.id, repeat: b!.repeat, date: b!.date, occDate, start: b!.start, end: b!.end, ...base };
    if (!armed) {
      const d = this.drag;
      d.timer = setTimeout(() => {
        if (this.drag !== d) return;
        d.armed = true; d.moved = true;
        try { navigator.vibrate?.(10); } catch { /* unsupported */ }
        if (d.mode === 'create') {
          const s = clamp(d.anchor!, 0, 1380);
          this.setState({ preview: { kind: 'create', date: addDays(this.viewStartDate(), d.day!), start: s, end: s + 60 } });
        } else this.onMove({ clientX: d.lastX, clientY: d.lastY } as PointerEvent);
      }, 300);
    }
    this.mv = ev => this.onMove(ev); this.up = () => this.onUp(); this.cancel = () => this.cancelDrag();
    window.addEventListener('pointermove', this.mv); window.addEventListener('pointerup', this.up); window.addEventListener('pointercancel', this.cancel);
  }
  endDrag() {
    if (this.drag?.timer) clearTimeout(this.drag.timer);
    if (this.mv) {
      window.removeEventListener('pointermove', this.mv); window.removeEventListener('pointerup', this.up!); window.removeEventListener('pointercancel', this.cancel!);
      this.mv = undefined;
    }
  }
  cancelDrag() { this.endDrag(); this.drag = null; if (this.state.preview) this.setState({ preview: null }); }
  onMove(e: PointerEvent) {
    const d = this.drag; if (!d) return;
    d.lastX = e.clientX; d.lastY = e.clientY;
    if (!d.armed) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 8) this.cancelDrag(); // it's a scroll
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4) d.moved = true;
    if (!d.moved) return;
    const ws = this.viewStartDate();
    let p: Preview;
    if (d.mode === 'create') {
      const cur = this.minFromY(e.clientY); const s = Math.min(d.anchor!, cur), en = Math.max(d.anchor! + 15, cur);
      const prev = this.state.preview;
      // mobile long-press create starts as a 1h block; keep that until the finger actually drags further.
      if (prev && prev.kind === 'create' && cur <= d.anchor! + 60 && cur >= d.anchor! && e.pointerType === 'touch') return;
      p = { kind: 'create', date: addDays(ws, d.day!), start: s, end: Math.min(1440, Math.max(en, s + 15)) };
    } else {
      const dm = snap((e.clientY - d.y0) / this.hh() * 60);
      if (d.mode === 'move') {
        const dur = d.end! - d.start!, s = clamp(d.start! + dm, 0, 1440 - dur);
        p = { kind: 'block', id: d.id!, date: d.repeat ? d.date! : addDays(ws, this.dayFromX(e.clientX)), start: s, end: s + dur };
      } else p = { kind: 'block', id: d.id!, date: d.date!, start: d.start!, end: clamp(d.end! + dm, d.start! + 15, 1440) };
    }
    this.setState({ preview: p });
  }
  onUp() {
    this.endDrag();
    const d = this.drag, p = this.state.preview; this.drag = null;
    if (!d) return;
    if (!d.moved || !p) {
      if (d.mode === 'create') this.setState({ sel: null, expanded: null, preview: null });
      else this.setState(s => ({ sel: { kind: 'block', id: d.id!, date: d.occDate! }, expanded: s.sel && s.sel.id === d.id ? s.expanded : null, preview: null }));
      return;
    }
    if (d.mode === 'create') { this.createBlock(p.date, p.start, p.end); return; }
    this.updBlock(d.id!, { start: p.start, end: p.end, date: d.repeat ? d.date! : p.date });
    this.setState({ preview: null, sel: { kind: 'block', id: d.id!, date: d.repeat ? d.occDate! : p.date } });
  }

  /** Popover with preset swatches + a custom color input for one label. */
  colorPalette(l: Label) {
    const setColor = (color: string) => this.setState(s => ({ labels: s.labels.map(x => x.id === l.id ? { ...x, color } : x) }));
    const isPreset = COLORS.some(c => c.toLowerCase() === l.color.toLowerCase());
    const swatch = (selected: boolean, color: string) => ({
      width: 22, height: 22, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 3.5px ${color}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)'
    } as const);
    return (
      <>
        <div onClick={() => this.setState({ colorPicker: null })} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
        <div role="dialog" aria-label={`Color for ${l.name}`} style={{ position: 'absolute', top: 'calc(100% - 2px)', left: 2, zIndex: 56, background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 0 0 0.5px rgba(0,0,0,0.12), 0 10px 30px rgba(0,0,0,0.16)', display: 'flex', flexDirection: 'column', gap: 10, animation: 'tb-fade-in .12s' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 22px)', gap: 10 }}>
            {COLORS.map(c => {
              const sel = c.toLowerCase() === l.color.toLowerCase();
              return (
                <button key={c} onClick={() => { setColor(c); this.setState({ colorPicker: null }); }} title={c} aria-label={`Color ${c}`} aria-pressed={sel} style={swatch(sel, c)}>
                  {sel && <Check size={10} />}
                </button>
              );
            })}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#3c3c43', cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 10 }}>
            <span style={{ ...swatch(!isPreset, isPreset ? '#fff' : l.color), position: 'relative', overflow: 'hidden', background: isPreset ? 'conic-gradient(#FF3B30,#FFCC00,#34C759,#30B0C7,#007AFF,#AF52DE,#FF2D55,#FF3B30)' : l.color }}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#007AFF'} onChange={e => setColor(e.target.value.toUpperCase())}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
            </span>
            Custom color…
          </label>
        </div>
      </>
    );
  }

  /** Label chips (toggle) plus a "+ New Label" chip that creates and assigns a label. */
  labelPicker(owner: string, selected: string[], setLabels: (fn: (cur: string[]) => string[]) => void, bg = '#fff') {
    const S = this.state, editing = S.chipDraft !== null && S.chipOwner === owner;
    const close = () => this.setState({ chipDraft: null, chipOwner: null });
    const onKey = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Enter') return;
      const name = (this.state.chipDraft || '').trim(); if (!name) return;
      const id = this.addLabel(name);
      setLabels(cur => cur.includes(id) ? cur : [...cur, id]);
      close();
    };
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {S.labels.map(l => {
          const has = selected.includes(l.id);
          return (
            <button key={l.id} onClick={() => setLabels(cur => cur.includes(l.id) ? cur.filter(x => x !== l.id) : [...cur, l.id])}
              style={{ border: `1px solid ${has ? hexA(l.color, 0.45) : 'rgba(0,0,0,0.1)'}`, background: has ? hexA(l.color, 0.14) : bg, color: has ? darken(l.color, 0.45) : '#3c3c43', borderRadius: 12, height: 24, padding: '0 10px 0 8px', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }} />{l.name}
            </button>
          );
        })}
        {!editing ? (
          <button onClick={() => this.setState({ chipDraft: '', chipOwner: owner })} style={{ border: '1px dashed rgba(60,60,67,0.3)', background: 'transparent', color: '#007AFF', borderRadius: 12, height: 24, padding: '0 10px 0 8px', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="9" height="9" viewBox="0 0 12 12"><path d="M6 1.5v9M1.5 6h9" stroke="#007AFF" strokeWidth="1.8" strokeLinecap="round" /></svg>New Label
          </button>
        ) : (
          <input autoFocus value={S.chipDraft!} onChange={e => this.setState({ chipDraft: e.target.value })} onKeyDown={onKey} onBlur={() => { if (!(this.state.chipDraft || '').trim()) close(); }}
            placeholder="Label name" enterKeyHint="done"
            style={{ border: 'none', outline: 'none', background: '#fff', borderRadius: 12, height: 24, padding: '0 10px', fontSize: S.isMobile ? 16 : 12, width: 120, boxShadow: 'inset 0 0 0 1px #007AFF' }} />
        )}
      </div>
    );
  }

  taskItem(t: Task, b: Block | null, date: string | null, vis: (t: Task) => boolean, L: Record<string, Label>) {
    const S = this.state, done = this.isDone(t, b, date), exp = S.expanded === t.id;
    const metaLabels = t.labels.filter(id => L[id]).map(id => ({ key: id, name: L[id].name, color: L[id].color }));
    const showMeta = !exp && (metaLabels.length > 0 || t.links.length > 0 || !!t.desc);
    const linkCount = t.links.length ? `${t.links.length} link${t.links.length > 1 ? 's' : ''}` : '';
    const onExpand = () => { if (this.state.expanded !== t.id) this.setState({ expanded: t.id, linkDraft: '', chipDraft: null, chipOwner: null }); };
    const onLinkKey = (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return; let v = this.state.linkDraft.trim(); if (!v) return;
      if (!/^[a-z]+:\/\//i.test(v)) v = 'https://' + v;
      if (!/^https?:\/\//i.test(v)) return; // only web links
      this.updTask(t.id, { links: [...t.links, v] }); this.setState({ linkDraft: '' });
    };
    const onToBacklog = () => this.setState(s => ({ blocks: s.blocks.map(x => x.id === b!.id ? { ...x, tasks: x.tasks.filter(y => y !== t.id) } : x), backlog: [t.id, ...s.backlog], expanded: null }));
    const onDelete = () => this.deleteTask(t.id);
    const setLabels = (fn: (cur: string[]) => string[]) => this.setState(s => {
      const cur = s.tasks[t.id]; if (!cur) return null;
      return { tasks: { ...s.tasks, [t.id]: { ...cur, labels: fn(cur.labels) } } };
    });

    return (
      <div key={t.id} className="hv-task" style={{ borderRadius: 10, background: exp ? '#F5F5F7' : 'transparent', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 10, opacity: vis(t) ? 1 : 0.45, transition: 'background .15s' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div onClick={() => this.toggleDone(t, b, date)} role="checkbox" aria-checked={done} style={{ width: 19, height: 19, marginTop: 0.5, borderRadius: '50%', border: `1.5px solid ${done ? '#007AFF' : 'rgba(60,60,67,0.3)'}`, background: done ? '#007AFF' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
            {done && <Check size={10} />}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input value={t.title} onChange={e => this.updTask(t.id, { title: e.target.value })} onFocus={onExpand} placeholder="Task"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 14, lineHeight: '19px', padding: 0, width: '100%', color: done ? '#8E8E93' : '#1d1d1f', textDecoration: done ? 'line-through' : 'none' }} />
            {showMeta && (
              <div onClick={onExpand} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#8E8E93' }}>
                {metaLabels.map(ml => (
                  <span key={ml.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: ml.color }} />{ml.name}</span>
                ))}
                {linkCount && <span>{linkCount}</span>}
                {t.desc && <span>Notes</span>}
              </div>
            )}
          </div>
          {!exp && (
            <button onClick={onDelete} title="Delete task" aria-label="Delete task" className="row-act" style={{ border: 'none', background: 'transparent', padding: 5, margin: '-2px -2px 0 0', cursor: 'pointer', display: 'flex', borderRadius: 5 }}>
              <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1 1 7" stroke="#8E8E93" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
          )}
          <button onClick={() => this.setState({ expanded: exp ? null : t.id, linkDraft: '', chipDraft: null, chipOwner: null })} className="hv-soft" style={{ border: 'none', background: 'transparent', padding: 4, margin: '-2px -4px 0 0', cursor: 'pointer', display: 'flex', borderRadius: 5 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: `rotate(${exp ? 90 : 0}deg)`, transition: 'transform .2s' }}><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="#8E8E93" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        {exp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 29 }}>
            <textarea value={t.desc} onChange={e => this.updTask(t.id, { desc: e.target.value })} placeholder="Add notes" rows={3}
              style={{ border: 'none', outline: 'none', resize: 'vertical', background: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: '18px', width: '100%', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: 0.3 }}>LABELS</span>
              {this.labelPicker('task:' + t.id, t.labels, setLabels)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: 0.3 }}>LINKS</span>
              {t.links.map((u, i) => (
                <div key={i + u} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 14 14" style={{ flexShrink: 0 }}><path d="M6 8a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M8 6a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" fill="none" stroke="#007AFF" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <a href={/^https?:\/\//i.test(u) ? u : undefined} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, color: '#007AFF' }}>{u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>
                  <button onClick={() => this.updTask(t.id, { links: t.links.filter((_, j) => j !== i) })} title="Remove link" className="hv-icon" style={{ border: 'none', background: 'transparent', padding: 2, cursor: 'pointer', display: 'flex', borderRadius: 4 }}>
                    <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1 1 7" stroke="#8E8E93" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              <input value={S.linkDraft} onChange={e => this.setState({ linkDraft: e.target.value })} onKeyDown={onLinkKey} placeholder="Paste a link and press Return" inputMode="url"
                style={{ border: 'none', outline: 'none', background: '#fff', borderRadius: 7, padding: '6px 10px', fontSize: 13, width: '100%', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {b && <button onClick={onToBacklog} className="hv-gray" style={{ border: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: 6, height: 26, padding: '0 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Move to Backlog</button>}
              <button onClick={onDelete} className="hv-redsoft" style={{ border: 'none', background: 'rgba(255,59,48,0.1)', color: '#D70015', borderRadius: 6, height: 26, padding: '0 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Delete Task</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // mobile: tap-to-schedule replaces drag-and-drop from the backlog.
  renderSchedule(t: Task) {
    const S = this.state;
    const options = S.blocks.filter(b => b.repeat ? occursOn(b, S.schedDate) : b.date === S.schedDate).sort((a, b) => a.start - b.start);
    const go = () => {
      const [h, m] = S.schedTime.split(':').map(Number);
      if (!S.schedDate || isNaN(h)) return;
      const date = S.schedDate;
      if (S.schedTarget === 'new' || !S.blocks.some(b => b.id === S.schedTarget)) {
        const st = clamp(h * 60 + (m || 0), 0, 1380);
        const b = this.createBlock(date, st, st + 60, { title: t.title, tasks: [] });
        this.scheduleTask(t.id, b.id);
      } else {
        this.scheduleTask(t.id, S.schedTarget);
        this.setState({ sel: { kind: 'block', id: S.schedTarget, date } });
      }
      this.setState({ viewStart: date, schedTarget: 'new' });
    };
    const field = { border: 'none', outline: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: 6, padding: '4px 8px', fontSize: 13, fontVariantNumeric: 'tabular-nums' } as const;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ background: '#F5F5F7', borderRadius: 10, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 44, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span>Day</span>
            <input type="date" value={S.schedDate} onChange={e => this.setState({ schedDate: e.target.value, schedTarget: 'new' })} style={field} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 44, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span>Block</span>
            <select value={S.schedTarget} onChange={e => this.setState({ schedTarget: e.target.value })} style={{ ...field, maxWidth: 190 }}>
              <option value="new">New block</option>
              {options.map(b => <option key={b.id} value={b.id}>{`${fmtT(b.start)} · ${b.title || 'Untitled'}`}</option>)}
            </select>
          </div>
          {S.schedTarget === 'new' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 44 }}>
              <span>Starts</span>
              <input type="time" step={900} value={S.schedTime} onChange={e => this.setState({ schedTime: e.target.value })} style={field} />
            </div>
          )}
        </div>
        <button onClick={go} className="hv-blue" style={{ border: 'none', background: '#007AFF', color: '#fff', height: 40, borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Add to Calendar</button>
      </div>
    );
  }

  render() {
    const S = this.state, hh = this.hh(), N = this.nDays(), ws = this.viewStartDate(), today = ds(S.now);
    const mobile = S.isMobile;
    const solid = BLOCK_STYLE === 'Solid';
    const L: Record<string, Label> = Object.fromEntries(S.labels.map(l => [l.id, l]));
    const vis = (t: Task) => { const ls = t.labels.filter(id => L[id]); return ls.length ? ls.some(id => L[id].on) : S.showUnlabeled; };
    const colorOf = (ts: Task[]) => { for (const t of ts) for (const id of t.labels) if (L[id]) return L[id].color; return '#007AFF'; };
    // A block's own labels win; otherwise it takes the color of its tasks' labels.
    const ownLabels = (b: { labels?: string[] }) => (b.labels || []).filter(id => L[id]);
    const blockColor = (b: { labels?: string[] }, ts: Task[]) => { const own = ownLabels(b); return own.length ? L[own[0]].color : colorOf(ts); };
    const P = S.preview, nowMin = S.now.getHours() * 60 + S.now.getMinutes();
    const inView = today >= ws && today <= addDays(ws, N - 1);

    type Occ = { b: Block | { id: string; title: string; tasks: string[]; repeat?: boolean; labels?: string[] }; start: number; end: number; vt: Task[]; ts: Task[]; selected?: boolean; ghost?: boolean; lane?: number; n?: number };

    const days = [...Array(N)].map((_, i) => {
      const date = addDays(ws, i), dt = parse(date), isToday = date === today, wkend = dt.getDay() % 6 === 0;
      const occ: Occ[] = [];
      for (const b0 of S.blocks) {
        const b = P && P.kind === 'block' && P.id === b0.id ? { ...b0, start: P.start, end: P.end, date: P.date } : b0;
        if (b.repeat ? !occursOn(b, date) : b.date !== date) continue;
        const ts = b.tasks.map(id => S.tasks[id]).filter(Boolean), vt = ts.filter(vis);
        const selected = !!(S.sel && S.sel.kind === 'block' && S.sel.id === b.id && (!b.repeat || S.sel.date === date));
        const own = ownLabels(b);
        if (!selected && (own.length ? !own.some(id => L[id].on) : ts.length > 0 && !vt.length)) continue;
        occ.push({ b, start: b.start, end: b.end, vt, ts, selected });
      }
      if (P && P.kind === 'create' && P.date === date) occ.push({ ghost: true, b: { id: '__ghost', title: P.title || 'New Block', tasks: [] }, start: P.start, end: P.end, vt: [], ts: [] });
      occ.sort((a, b) => a.start - b.start || b.end - a.end);
      let cluster: Occ[] = [], ends: number[] = [], maxEnd = -1;
      const flush = () => { cluster.forEach(o => o.n = ends.length); cluster = []; ends = []; };
      for (const o of occ) {
        if (cluster.length && o.start >= maxEnd) flush();
        let li = ends.findIndex(e => e <= o.start);
        if (li < 0) { li = ends.length; ends.push(o.end); } else ends[li] = o.end;
        o.lane = li; cluster.push(o); maxEnd = Math.max(maxEnd, o.end);
      }
      flush();
      return { date, dt, isToday, wkend, occ };
    });

    const blockOf = (o: Occ, date: string) => {
      const c = o.ghost ? '#007AFF' : blockColor(o.b, o.vt.length ? o.vt : o.ts);
      const h = Math.max((o.end - o.start) / 60 * hh - 2, 16), showTime = h >= 36;
      const on = !o.ghost && (o.selected || solid);
      const max = Math.max(0, Math.floor((h - (showTime ? 36 : 22)) / 15));
      const real = o.ghost ? null : (o.b as Block);
      const lines = o.vt.slice(0, max);
      const extra = o.vt.length - lines.length;
      const wPct = 100 / o.n!;
      return (
        <div key={o.b.id + date}
          onPointerDown={real ? e => this.startDrag(e, 'move', real, date) : undefined}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (this.state.preview) this.setState({ preview: null }); }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); const tid = e.dataTransfer.getData('text/plain'); if (real && S.tasks[tid]) { this.scheduleTask(tid, real.id); this.setState({ sel: { kind: 'block', id: real.id, date } }); } }}
          style={{ position: 'absolute', top: o.start / 60 * hh + 1, height: h, left: `calc(${o.lane! * wPct}% + 2px)`, width: `calc(${wPct}% - 4px)`,
            background: o.ghost ? hexA(c, 0.2) : on ? (o.selected ? darken(c, 0.08) : c) : hexA(c, 0.15), color: on ? '#fff' : darken(c, 0.5),
            borderRadius: 6, padding: h < 30 ? '1px 6px' : '4px 7px', overflow: 'hidden',
            boxShadow: o.selected ? `0 0 0 2px #fff, 0 6px 18px ${hexA(c, 0.45)}` : o.ghost ? `inset 0 0 0 1.5px ${c}` : `inset 0 0 0 1px ${hexA(c, 0.3)}`,
            zIndex: o.selected ? 10 : o.ghost ? 12 : 2, pointerEvents: o.ghost ? 'none' : 'auto', display: 'flex', flexDirection: 'column', gap: 1, cursor: 'default', transition: 'box-shadow .15s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, fontSize: 12, lineHeight: '15px' }}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.b.title || 'Untitled'}</span>
            {!!o.b.repeat && <RepeatIcon size={10} stroke="currentColor" sw={1.6} />}
          </div>
          {showTime && <div style={{ fontSize: 11, lineHeight: '14px', opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>{`${fmtT(o.start)} – ${fmtT(o.end)}`}</div>}
          {lines.map(t => {
            const dn = this.isDone(t, real, date);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, lineHeight: '15px', minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, border: '1.2px solid currentColor', background: dn ? 'currentColor' : 'transparent' }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: dn ? 'line-through' : 'none', opacity: dn ? 0.6 : 1 }}>{t.title}</span>
              </div>
            );
          })}
          {extra > 0 && max > 0 && <div style={{ fontSize: 11, lineHeight: '14px', opacity: 0.7 }}>{`+${extra} more`}</div>}
          {real && <div onPointerDown={e => this.startDrag(e, 'resize', real, date)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: mobile ? 12 : 7, cursor: 'ns-resize', touchAction: 'none' }} />}
        </div>
      );
    };

    // sidebar data
    const backlogAll = S.backlog.map(id => S.tasks[id]).filter(Boolean);
    const backVis = backlogAll.filter(vis);
    const hiddenN = backlogAll.length - backVis.length;
    const anyOff = S.labels.some(l => !l.on) || !S.showUnlabeled;
    const countOf = (id: string | null) => Object.values(S.tasks).filter(t => id ? t.labels.includes(id) : !t.labels.some(x => L[x])).length
      + (id ? S.blocks.filter(b => b.labels.includes(id)).length : 0);
    const routines = S.blocks.filter(b => b.repeat).sort((a, b) => a.start - b.start);

    // inspector
    const sb = S.sel && S.sel.kind === 'block' ? S.blocks.find(b => b.id === S.sel!.id) : undefined;
    const st = S.sel && S.sel.kind === 'task' ? S.tasks[S.sel.id] : undefined;
    const isBlock = !!sb, isTask = !sb && !!st;
    const inspOpen = isBlock || isTask;

    const endD = parse(addDays(ws, N - 1)), startD = parse(ws);
    const sameM = startD.getMonth() === endD.getMonth();
    const monthTitle = sameM ? (mobile ? MONTHS[startD.getMonth()].slice(0, 3) : MONTHS[startD.getMonth()]) : `${MONTHS[startD.getMonth()].slice(0, 3)} – ${MONTHS[endD.getMonth()].slice(0, 3)}`;

    const onNewBlock = () => { const s = clamp(Math.ceil((nowMin + 1) / 60) * 60, 8 * 60, 22 * 60); this.createBlock(inView ? today : ws, s, s + 60); };
    const onNewRoutine = () => { this.createBlock(inView ? today : ws, 8 * 60, 8 * 60 + 30, { title: 'New Routine', repeat: true }); this.wantFocus = !mobile; };
    const onToday = () => { this.setState({ viewStart: null }); if (this.scrollRef.current) this.scrollRef.current.scrollTop = Math.max(0, nowMin / 60 * hh - 160); };
    const gutter = mobile ? 44 : 56;

    const sidebar = (
      <aside style={{ width: mobile ? 'min(300px, 86vw)' : 256, flexShrink: 0, background: '#F5F5F7', borderRight: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: mobile ? 'calc(20px + env(safe-area-inset-top)) 12px calc(20px + env(safe-area-inset-bottom))' : '20px 12px 20px', gap: 26,
        ...(mobile ? { position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 51, animation: 'tb-drawer-in .22s ease-out', boxShadow: '12px 0 32px rgba(0,0,0,0.12)' } : {}) }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 8px' }}>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.4 }}>Backlog</span>
            <span style={{ fontSize: 13, color: '#8E8E93', fontVariantNumeric: 'tabular-nums' }}>{backlogAll.length}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.05)', borderRadius: 8, padding: '0 10px', height: 30, margin: '2px 0 4px' }}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#8E8E93" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <input value={S.backlogDraft} onChange={e => this.setState({ backlogDraft: e.target.value })} enterKeyHint="done"
              onKeyDown={e => { if (e.key !== 'Enter' || !S.backlogDraft.trim()) return; const t = this.newTask(S.backlogDraft.trim()); this.setState(s => ({ tasks: { ...s.tasks, [t.id]: t }, backlog: [t.id, ...s.backlog], backlogDraft: '' })); }}
              placeholder="New task" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: mobile ? 16 : 13, padding: 0 }} />
          </div>
          {backVis.map(t => {
            const sel = S.sel && S.sel.kind === 'task' && S.sel.id === t.id, dots = t.labels.filter(id => L[id]);
            return (
              <div key={t.id} draggable={!mobile} className="hv-row"
                onDragStart={e => { this.dragTask = t.id; e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { this.dragTask = null; if (this.state.preview) this.setState({ preview: null }); }}
                onClick={() => this.setState({ sel: { kind: 'task', id: t.id }, expanded: t.id, linkDraft: '', drawerOpen: false, schedDate: inView ? today : ws, schedTarget: 'new', schedTime: hm(clamp(Math.ceil((nowMin + 1) / 60) * 60, 8 * 60, 22 * 60)) })}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 8px', borderRadius: 8, background: sel ? 'rgba(0,122,255,0.12)' : 'transparent', cursor: mobile ? 'pointer' : 'grab' }}>
                <div onClick={e => { e.stopPropagation(); this.updTask(t.id, { done: !t.done }); }} role="checkbox" aria-checked={t.done} style={{ width: 17, height: 17, marginTop: 0.5, borderRadius: '50%', border: `1.5px solid ${t.done ? '#007AFF' : 'rgba(60,60,67,0.3)'}`, background: t.done ? '#007AFF' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                  {t.done && <Check />}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ lineHeight: '17px', color: t.done ? '#8E8E93' : '#1d1d1f', textDecoration: t.done ? 'line-through' : 'none', textWrap: 'pretty' } as React.CSSProperties}>{t.title || 'Untitled'}</span>
                  {dots.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {dots.map(id => <span key={id} style={{ width: 7, height: 7, borderRadius: '50%', background: L[id].color }} />)}
                    </div>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); this.deleteTask(t.id); }} onPointerDown={e => e.stopPropagation()} draggable={false} title="Delete task" aria-label="Delete task" className="row-act"
                  style={{ border: 'none', background: 'transparent', padding: 4, margin: '-1px -4px -1px 0', cursor: 'pointer', display: 'flex', borderRadius: 4, flexShrink: 0 }}>
                  <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1 1 7" stroke="#8E8E93" strokeWidth="1.4" strokeLinecap="round" /></svg>
                </button>
              </div>
            );
          })}
          {backlogAll.length === 0 && <div style={{ padding: '6px 8px', color: '#8E8E93', lineHeight: '18px' }}>{mobile ? 'Nothing here. Add a task, then tap it to schedule it.' : 'Nothing here. Add a task, then drag it onto the calendar.'}</div>}
          {hiddenN > 0 && <div style={{ padding: '2px 8px', color: '#8E8E93', fontSize: 12 }}>{`${hiddenN} hidden by label filters`}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#8E8E93' }}>Daily Routines</span>
            <button onClick={onNewRoutine} title="New daily routine" className="hv-icon" style={{ border: 'none', background: 'transparent', padding: 2, cursor: 'pointer', display: 'flex', borderRadius: 5 }}><svg width="14" height="14" viewBox="0 0 12 12"><path d="M6 1.5v9M1.5 6h9" stroke="#007AFF" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
          </div>
          {routines.map(b => {
            const ts = b.tasks.map(id => S.tasks[id]).filter(Boolean);
            const sub = [b.repeatDays.length < 7 ? daysSummary(b.repeatDays, MONDAY_FIRST) : '', endSummary(b, today)].filter(Boolean).join(' · ');
            return (
              <div key={b.id} className="hv-row" onClick={() => {
                  // Show the routine on its first occurrence in view (today if it runs today).
                  const cands = [...Array(N)].map((_, i) => addDays(ws, i));
                  const date = (inView && occursOn(b, today) ? today : cands.find(dd => occursOn(b, dd))) ?? (inView ? today : ws);
                  this.setState({ sel: { kind: 'block', id: b.id, date }, expanded: null, drawerOpen: false });
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: S.sel && S.sel.kind === 'block' && S.sel.id === b.id ? 'rgba(0,122,255,0.12)' : 'transparent' }}>
                <RepeatIcon size={13} stroke={blockColor(b, ts)} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title || 'Untitled'}</span>
                  {sub && <span style={{ fontSize: 11, color: '#8E8E93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
                </div>
                <span style={{ color: '#8E8E93', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtT(b.start)}</span>
              </div>
            );
          })}
          {routines.length === 0 && <div style={{ padding: '4px 8px', color: '#8E8E93', lineHeight: '18px' }}>Blocks set to repeat show up here.</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#8E8E93' }}>Labels</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button onClick={() => this.setState(s => ({ labels: s.labels.map(l => ({ ...l, on: anyOff })), showUnlabeled: anyOff }))} style={{ border: 'none', background: 'transparent', color: '#007AFF', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}>{anyOff ? 'Show All' : 'Hide All'}</button>
              <button onClick={() => this.labelInputRef.current?.focus()} title="New label" className="hv-icon" style={{ border: 'none', background: 'transparent', padding: 2, cursor: 'pointer', display: 'flex', borderRadius: 5 }}><svg width="14" height="14" viewBox="0 0 12 12"><path d="M6 1.5v9M1.5 6h9" stroke="#007AFF" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
            </div>
          </div>
          {S.labels.map(l => (
            <div key={l.id} className="hv-lbl" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 8px', borderRadius: 8, position: 'relative' }}>
              <button onClick={() => this.setState({ colorPicker: S.colorPicker === l.id ? null : l.id })} title="Change color" aria-label={`Change color of ${l.name}`} aria-expanded={S.colorPicker === l.id}
                style={{ width: 12, height: 12, padding: 0, border: 'none', borderRadius: '50%', background: l.color, flexShrink: 0, cursor: 'pointer', boxShadow: S.colorPicker === l.id ? `0 0 0 2px #F5F5F7, 0 0 0 3.5px ${l.color}` : 'none' }} />
              {S.colorPicker === l.id && this.colorPalette(l)}
              {S.editingLabel === l.id ? (
                <input autoFocus value={S.labelEditDraft} onChange={e => this.setState({ labelEditDraft: e.target.value })} onBlur={() => this.commitLabelEdit()} enterKeyHint="done"
                  onKeyDown={e => { if (e.key === 'Enter') this.commitLabelEdit(); if (e.key === 'Escape') { e.stopPropagation(); this.setState({ editingLabel: null }); } }}
                  style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: '#fff', borderRadius: 5, padding: '1px 5px', margin: '-2px 0 -2px -5px', fontSize: mobile ? 16 : 13, boxShadow: 'inset 0 0 0 1px #007AFF' }} />
              ) : (
                <span onDoubleClick={() => this.setState({ editingLabel: l.id, labelEditDraft: l.name })} title="Double-click to rename" style={{ flex: 1, minWidth: 0, color: l.on ? '#1d1d1f' : '#8E8E93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{l.name}</span>
              )}
              <button onClick={() => this.deleteLabel(l.id)} title="Delete label" aria-label={`Delete label ${l.name}`} className="row-act"
                style={{ border: 'none', background: 'transparent', padding: 4, margin: '-4px -6px -4px -4px', cursor: 'pointer', display: 'flex', borderRadius: 4, flexShrink: 0 }}>
                <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1 1 7" stroke="#8E8E93" strokeWidth="1.4" strokeLinecap="round" /></svg>
              </button>
              <span style={{ color: '#8E8E93', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{countOf(l.id)}</span>
              <Toggle on={l.on} onClick={() => this.setState(s => ({ labels: s.labels.map(x => x.id === l.id ? { ...x, on: !x.on } : x) }))} />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 8px', borderRadius: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'transparent', border: '1.5px solid rgba(60,60,67,0.3)', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, color: S.showUnlabeled ? '#1d1d1f' : '#8E8E93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>No Label</span>
            <span style={{ color: '#8E8E93', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{countOf(null)}</span>
            <Toggle on={S.showUnlabeled} onClick={() => this.setState(s => ({ showUnlabeled: !s.showUnlabeled }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 8px', marginTop: 2 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px dashed rgba(60,60,67,.3)', flexShrink: 0 }} />
            <input ref={this.labelInputRef} value={S.labelDraft} onChange={e => this.setState({ labelDraft: e.target.value })} enterKeyHint="done"
              onKeyDown={e => {
                if (e.key !== 'Enter' || !S.labelDraft.trim()) return;
                this.addLabel(S.labelDraft.trim());
                this.setState({ labelDraft: '' });
              }}
              placeholder="Add label" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: mobile ? 16 : 13, padding: 0 }} />
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: '0 8px' }}>
          <button onClick={this.props.onLogout} style={{ border: 'none', background: 'transparent', color: '#8E8E93', fontSize: 12, cursor: 'pointer', padding: 0 }}>Sign Out</button>
        </div>
      </aside>
    );

    let inspector: React.ReactNode = null;
    if (inspOpen) {
      let kicker = '', body: React.ReactNode = null, tasks: React.ReactNode[] = [], footer: React.ReactNode = null;
      if (sb) {
        const date = (S.sel as { date: string }).date, dt = parse(date);
        const ts = sb.tasks.map(id => S.tasks[id]).filter(Boolean);
        tasks = ts.map(t => this.taskItem(t, sb, date, vis, L));
        const doneN = ts.filter(t => this.isDone(t, sb, date)).length;
        kicker = !sb.repeat ? 'TIME BLOCK' : sb.repeatDays.length === 7 ? 'DAILY ROUTINE' : 'ROUTINE';
        const setTime = (k: 'start' | 'end', v: string) => {
          const [h, m] = v.split(':').map(Number); if (isNaN(h)) return;
          const mins = h * 60 + (m || 0); let { start, end } = sb;
          if (k === 'start') { const dur = end - start; start = mins; if (end <= start) end = Math.min(1440, start + dur); }
          else { end = mins || 1440; if (end <= start) start = Math.max(0, end - 15); }
          this.updBlock(sb.id, { start, end });
        };
        const timeInput = { border: 'none', outline: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontVariantNumeric: 'tabular-nums' } as const;
        body = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input ref={this.titleRef} value={sb.title} onChange={e => this.updBlock(sb.id, { title: e.target.value })} placeholder="Block name"
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 22, fontWeight: 700, letterSpacing: -0.5, padding: 0, width: '100%' }} />
              <span style={{ color: '#8E8E93', fontSize: 13 }}>{sb.repeat ? `${daysSummary(sb.repeatDays, MONDAY_FIRST)} · showing ${DOWL[dt.getDay()]}, ${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}` : `${DOWL[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}`}</span>
            </div>
            <div style={{ background: '#F5F5F7', borderRadius: 10, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 40, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <span>Starts</span>
                <input type="time" step={900} value={hm(sb.start)} onChange={e => setTime('start', e.target.value)} style={timeInput} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 40, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <span>Ends</span>
                <input type="time" step={900} value={sb.end >= 1440 ? '23:59' : hm(sb.end)} onChange={e => setTime('end', e.target.value)} style={timeInput} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 44 }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}><span>{sb.repeat ? 'Repeat' : 'Repeat every day'}</span></div>
                <Toggle on={sb.repeat} w={38} h={22} onClick={() => this.updBlock(sb.id, sb.repeat ? { repeat: false, date, repeatEnd: null } : { repeat: true, repeatDays: ALL_DAYS, repeatEnd: null })} />
              </div>
              {sb.repeat && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 12px' }}>
                  <div role="group" aria-label="Repeat on" style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                    {dayOrder(MONDAY_FIRST).map(d => {
                      const on = sb.repeatDays.includes(d), last = on && sb.repeatDays.length === 1;
                      return (
                        <button key={d} aria-pressed={on} aria-label={DOWL[d]} title={last ? 'At least one day is required' : DOWL[d]} disabled={last}
                          onClick={() => this.updBlock(sb.id, { repeatDays: on ? sb.repeatDays.filter(x => x !== d) : [...sb.repeatDays, d].sort() })}
                          style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', padding: 0, cursor: last ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, background: on ? '#007AFF' : '#fff', color: on ? '#fff' : '#3c3c43', boxShadow: on ? 'none' : 'inset 0 0 0 1px rgba(0,0,0,0.1)', transition: 'background .15s' }}>
                          {DOWL[d][0]}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {([['Every day', ALL_DAYS], ['Weekdays', [1, 2, 3, 4, 5]], ['Weekends', [0, 6]]] as const).map(([name, days]) => {
                      const active = days.length === sb.repeatDays.length && days.every(x => sb.repeatDays.includes(x));
                      return (
                        <button key={name} onClick={() => this.updBlock(sb.id, { repeatDays: [...days] })}
                          style={{ border: 'none', background: active ? 'rgba(0,122,255,0.12)' : 'rgba(0,0,0,0.05)', color: active ? '#007AFF' : '#3c3c43', borderRadius: 6, height: 24, padding: '0 9px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{name}</button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                    <span>Ends</span>
                    <div role="group" aria-label="Ends" style={{ display: 'flex', gap: 6 }}>
                      {([['Never', null], ['On date', { type: 'until', date: addDays(date, 30) }], ['After', { type: 'count', count: 10 }]] as const).map(([name, end]) => {
                        const active = (sb.repeatEnd?.type ?? null) === (end?.type ?? null);
                        return (
                          // Occurrences are counted from the day being viewed, so an old routine doesn't start out already used up.
                          <button key={name} aria-pressed={active} onClick={() => { if (!active) this.updBlock(sb.id, end?.type === 'count' ? { repeatEnd: end, date } : { repeatEnd: end }); }}
                            style={{ border: 'none', background: active ? 'rgba(0,122,255,0.12)' : 'rgba(0,0,0,0.05)', color: active ? '#007AFF' : '#3c3c43', borderRadius: 6, height: 24, padding: '0 9px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{name}</button>
                        );
                      })}
                    </div>
                  </div>
                  {sb.repeatEnd?.type === 'until' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Last day</span>
                      <input type="date" aria-label="Last day" value={sb.repeatEnd.date} onChange={e => { if (e.target.value) this.updBlock(sb.id, { repeatEnd: { type: 'until', date: e.target.value } }); }} style={timeInput} />
                    </div>
                  )}
                  {sb.repeatEnd?.type === 'count' && (() => {
                    const count = sb.repeatEnd.count;
                    return (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>Occurrences</span>
                          {/* Uncontrolled so the field can be empty while typing; a blur restores the saved value. */}
                          <input key={sb.id} type="number" aria-label="Occurrences" min={1} max={999} defaultValue={count}
                            onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 999) this.updBlock(sb.id, { repeatEnd: { type: 'count', count: n } }); }}
                            onBlur={e => { e.target.value = String(count); }}
                            style={{ ...timeInput, width: 64, textAlign: 'right' }} />
                        </div>
                        <span style={{ color: '#8E8E93', fontSize: 12 }}>{`${shortDate(sb.date, ds(S.now))} to ${shortDate(repeatLastDate(sb)!, ds(S.now))}`}</span>
                      </>
                    );
                  })()}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px 12px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <span>Labels</span>
                {this.labelPicker('block:' + sb.id, sb.labels, fn => this.setState(s => ({ blocks: s.blocks.map(b => b.id === sb.id ? { ...b, labels: fn(b.labels) } : b) })))}
              </div>
            </div>
          </div>
        );
        tasks = [
          <div key="__hdr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 2px 4px' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Tasks</span>
            <span style={{ color: '#8E8E93', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{ts.length ? `${doneN} of ${ts.length} done` : ''}</span>
          </div>,
          ...tasks,
          <div key="__add" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
            <span style={{ width: 19, height: 19, borderRadius: '50%', border: '1.5px dashed rgba(60,60,67,0.3)', flexShrink: 0 }} />
            <input value={S.taskDraft} onChange={e => this.setState({ taskDraft: e.target.value })} enterKeyHint="done"
              onKeyDown={e => {
                if (e.key !== 'Enter' || !S.taskDraft.trim()) return; const t = this.newTask(S.taskDraft.trim());
                this.setState(s => ({ tasks: { ...s.tasks, [t.id]: t }, blocks: s.blocks.map(b => b.id === sb.id ? { ...b, tasks: [...b.tasks, t.id] } : b), taskDraft: '' }));
              }}
              placeholder="Add a task" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: mobile ? 16 : 14, padding: 0 }} />
          </div>
        ];
        footer = (
          <div style={{ flexShrink: 0, borderTop: '1px solid rgba(0,0,0,0.08)', padding: mobile ? '12px 18px calc(12px + env(safe-area-inset-bottom))' : '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 11.5, color: '#8E8E93', lineHeight: '15px' }}>Unfinished tasks return to the backlog.</span>
            <button onClick={() => this.deleteBlock(sb.id)} className="hv-redghost" style={{ border: 'none', background: 'transparent', color: '#FF3B30', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}>Delete Block</button>
          </div>
        );
      } else if (st) {
        kicker = 'BACKLOG TASK';
        body = mobile ? this.renderSchedule(st) : <div style={{ color: '#8E8E93', lineHeight: '18px', textWrap: 'pretty' } as React.CSSProperties}>Drag this task from the sidebar onto a block or an empty slot to schedule it.</div>;
        tasks = [this.taskItem(st, null, null, vis, L)];
      }
      inspector = (
        <aside style={{ position: mobile ? 'fixed' : 'absolute', top: 0, right: 0, bottom: 0, zIndex: mobile ? 60 : 40, width: mobile ? '100%' : 340, maxWidth: '100%', borderLeft: '1px solid rgba(0,0,0,0.08)', background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '-12px 0 32px rgba(0,0,0,0.08)', ...(mobile ? { animation: 'tb-sheet-in .2s ease-out', paddingTop: 'env(safe-area-inset-top)' } : {}) }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8E8E93', letterSpacing: 0.2 }}>{kicker}</span>
              <button onClick={() => this.setState({ sel: null, expanded: null })} title="Close" className="hv-close" style={{ border: 'none', background: 'rgba(0,0,0,0.05)', width: mobile ? 28 : 22, height: mobile ? 28 : 22, borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1 1 7" stroke="#3c3c43" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
            {body}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{tasks}</div>
          </div>
          {footer}
        </aside>
      );
    }

    const navBtn = { border: 'none', background: 'transparent', width: 28, height: 24, borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

    return (
      <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', fontSize: 13, letterSpacing: -0.08, position: 'relative' }}>
        {!mobile && sidebar}
        {mobile && S.drawerOpen && (
          <>
            <div onClick={() => this.setState({ drawerOpen: false })} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, animation: 'tb-fade-in .2s' }} />
            {sidebar}
          </>
        )}

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <header style={{ height: 'calc(56px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: mobile ? 8 : 12, paddingLeft: mobile ? 12 : 20, paddingRight: mobile ? 12 : 20, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {mobile && (
                <button onClick={() => this.setState({ drawerOpen: true })} title="Backlog, routines & labels" aria-label="Open sidebar" className="hv-soft" style={{ border: 'none', background: 'transparent', width: 32, height: 32, marginLeft: -6, borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0 }}>
                  <svg width="18" height="14" viewBox="0 0 18 14"><path d="M1 1h16M1 7h16M1 13h16" stroke="#3c3c43" strokeWidth="1.7" strokeLinecap="round" /></svg>
                  {backlogAll.length > 0 && <span style={{ position: 'absolute', top: 4, right: 3, width: 7, height: 7, borderRadius: '50%', background: '#007AFF' }} />}
                </button>
              )}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0, overflow: 'hidden' }}>
                <span style={{ fontSize: mobile ? 20 : 22, fontWeight: 700, letterSpacing: -0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{monthTitle}</span>
                {!mobile && <span style={{ fontSize: 22, fontWeight: 400, letterSpacing: -0.5, color: '#8E8E93' }}>{endD.getFullYear()}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 6 : 10, flexShrink: 0 }}>
              {mobile && (
                <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.05)', borderRadius: 7, padding: 2, gap: 2 }}>
                  {([1, 3] as const).map(n => (
                    <button key={n} onClick={() => this.setState({ mobileDays: n })} aria-label={`${n}-day view`} style={{ border: 'none', background: S.mobileDays === n ? '#fff' : 'transparent', boxShadow: S.mobileDays === n ? '0 0.5px 1.5px rgba(0,0,0,.15)' : 'none', height: 24, minWidth: 26, padding: '0 6px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{n}D</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.05)', borderRadius: 7, padding: 2, gap: 2 }}>
                <button onClick={() => this.setState({ viewStart: addDays(ws, -N) })} aria-label="Previous" className="hv-white" style={navBtn}><svg width="8" height="12" viewBox="0 0 8 12"><path d="M6.5 1 1.5 6l5 5" fill="none" stroke="#3c3c43" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                <button onClick={onToday} style={{ border: 'none', background: '#fff', height: 24, padding: mobile ? '0 8px' : '0 12px', borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 500, boxShadow: '0 0.5px 1.5px rgba(0,0,0,.15)' }}>Today</button>
                <button onClick={() => this.setState({ viewStart: addDays(ws, N) })} aria-label="Next" className="hv-white" style={navBtn}><svg width="8" height="12" viewBox="0 0 8 12"><path d="M1.5 1l5 5-5 5" fill="none" stroke="#3c3c43" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              </div>
              <button onClick={onNewBlock} aria-label="New Block" className="hv-blue" style={{ border: 'none', background: '#007AFF', color: '#fff', height: 28, padding: mobile ? '0 9px' : '0 12px 0 10px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>{!mobile && 'New Block'}
              </button>
            </div>
          </header>

          <div ref={this.scrollRef} style={{ flex: 1, overflowY: 'auto', position: 'relative', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,0.86)', backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)', display: 'grid', gridTemplateColumns: `${gutter}px repeat(${N},minmax(0,1fr))`, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <div />
              {days.map(d => (
                <div key={d.date} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px', padding: '8px 4px 8px 10px', minWidth: 0, overflow: 'hidden' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color: d.isToday ? '#FF3B30' : '#8E8E93' }}>{DOW[d.dt.getDay()]}</span>
                  <span style={{ minWidth: 26, height: 26, padding: '0 4px', borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: d.isToday ? '#FF3B30' : 'transparent', color: d.isToday ? '#fff' : (d.wkend ? '#8E8E93' : '#1d1d1f'), fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{d.dt.getDate()}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `${gutter}px minmax(0,1fr)` }}>
              <div style={{ position: 'relative', height: 24 * hh }}>
                {[...Array(23)].map((_, i) => (
                  <div key={i} style={{ position: 'absolute', top: (i + 1) * hh - 7, right: 8, fontSize: 10.5, color: '#8E8E93', fontVariantNumeric: 'tabular-nums' }}>{`${(i + 1) % 12 || 12} ${i + 1 < 12 ? 'AM' : 'PM'}`}</div>
                ))}
              </div>
              <div ref={this.colsRef} className="no-callout" onPointerDown={e => this.startDrag(e, 'create')} onContextMenu={e => e.preventDefault()}
                style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${N},minmax(0,1fr))`, height: 24 * hh, userSelect: 'none', WebkitUserSelect: 'none' }}>
                {days.map(d => (
                  <div key={d.date}
                    onDragOver={e => {
                      e.preventDefault(); const tid = this.dragTask; const t = tid && S.tasks[tid];
                      const st0 = clamp(this.minFromY(e.clientY, true), 0, 1380);
                      const cur = this.state.preview;
                      if (!cur || cur.date !== d.date || cur.start !== st0) this.setState({ preview: { kind: 'create', date: d.date, start: st0, end: st0 + 60, title: t ? t.title : 'New Block' } });
                    }}
                    onDragLeave={e => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node) && this.state.preview?.kind === 'create' && this.state.preview.date === d.date) this.setState({ preview: null }); }}
                    onDrop={e => {
                      e.preventDefault(); const tid = e.dataTransfer.getData('text/plain'); const t = S.tasks[tid]; if (!t) return;
                      const st0 = clamp(this.minFromY(e.clientY, true), 0, 1380);
                      const b = this.createBlock(d.date, st0, st0 + 60, { title: t.title, tasks: [] });
                      this.scheduleTask(tid, b.id);
                    }}
                    style={{ position: 'relative', borderLeft: '1px solid rgba(0,0,0,0.08)', backgroundColor: d.wkend ? 'rgba(0,0,0,0.018)' : 'transparent', backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0.07) 0, rgba(0,0,0,0.07) 1px, transparent 1px, transparent ${hh}px)` }}>
                    {d.occ.map(o => blockOf(o, d.date))}
                    {d.isToday && (
                      <div style={{ position: 'absolute', left: -4, right: 0, top: nowMin / 60 * hh, height: 0, zIndex: 15, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF3B30', flexShrink: 0, marginTop: -1 }} />
                        <span style={{ flex: 1, height: 1.5, background: '#FF3B30' }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>

        {inspector}

        {S.undo && (
          <div role="status" style={{ position: 'fixed', left: '50%', bottom: S.syncStatus === 'error' ? 'calc(60px + env(safe-area-inset-bottom))' : 'calc(16px + env(safe-area-inset-bottom))', transform: 'translateX(-50%)', zIndex: 70, background: 'rgba(29,29,31,0.92)', color: '#fff', borderRadius: 18, padding: '6px 6px 6px 14px', fontSize: 12.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 6px 20px rgba(0,0,0,0.18)', whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 32px)', animation: 'tb-sheet-in .18s ease-out' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{S.undo.text}</span>
            <button onClick={this.runUndo} style={{ border: 'none', background: 'rgba(255,255,255,0.16)', color: '#fff', borderRadius: 12, height: 24, padding: '0 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Undo</button>
          </div>
        )}
        {S.syncStatus === 'error' && (
          <div role="status" style={{ position: 'fixed', left: '50%', bottom: 'calc(16px + env(safe-area-inset-bottom))', transform: 'translateX(-50%)', zIndex: 70, background: 'rgba(29,29,31,0.92)', color: '#fff', borderRadius: 18, padding: '8px 14px', fontSize: 12.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.18)', whiteSpace: 'nowrap' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF9500' }} />
            {navigator.onLine ? 'Couldn’t save changes. Retrying…' : 'Offline — changes not saved yet'}
          </div>
        )}
      </div>
    );
  }
}
