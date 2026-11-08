import type { Block } from '../../shared/types';

export const COLORS = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#FF2D55', '#30B0C7', '#FFCC00', '#5856D6', '#A2845E'];
export const uid = () => Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 6);
export const pad = (n: number) => String(n).padStart(2, '0');
export const ds = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ds(d); };
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const snap = (m: number) => Math.round(m / 15) * 15;
export const hm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
export const fmtT = (m: number) => { let h = Math.floor(m / 60) % 24; const mm = m % 60, ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${pad(mm)} ${ap}`; };
const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const hexA = (h: string, a: number) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };
export const darken = (h: string, f: number) => { const [r, g, b] = rgb(h).map(v => Math.round(v * (1 - f))); return `rgb(${r},${g},${b})`; };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Weekday order for display, honoring the week start. */
export const dayOrder = (mondayFirst: boolean) => mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : ALL_DAYS;
/** "Every day", "Weekdays", "Weekends" or e.g. "Mon, Wed, Fri". */
export function daysSummary(days: number[], mondayFirst = false): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  return dayOrder(mondayFirst).filter(d => set.has(d)).map(d => DOW_SHORT[d]).join(', ');
}

type Repeating = Pick<Block, 'date' | 'repeatDays' | 'repeatEnd'>;
const daysOf = (b: Repeating) => b.repeatDays?.length ? b.repeatDays : ALL_DAYS;

/** The last date a repeating block can occur on, or null if it never ends. */
export function repeatLastDate(b: Repeating): string | null {
  const end = b.repeatEnd;
  if (!end) return null;
  if (end.type === 'until') return end.date;
  // Any 7 consecutive days hold exactly days.length occurrences, so skip whole weeks and walk the rest.
  const days = daysOf(b), start = parse(b.date).getDay();
  const weeks = Math.floor((end.count - 1) / days.length);
  let left = end.count - weeks * days.length, off = weeks * 7;
  for (; ; off++) if (days.includes((start + off) % 7) && --left === 0) return addDays(b.date, off);
}

/** Whether a repeating block has an occurrence on the given date. */
export function occursOn(b: Repeating, date: string): boolean {
  if (!daysOf(b).includes(parse(date).getDay())) return false;
  if (b.repeatEnd?.type === 'count' && date < b.date) return false;
  const last = repeatLastDate(b);
  return !last || date <= last;
}

/** "Nov 20", with the year when it differs from `today`'s. */
export function shortDate(date: string, today: string): string {
  const d = parse(date);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}${date.slice(0, 4) === today.slice(0, 4) ? '' : `, ${d.getFullYear()}`}`;
}

/** "Until Nov 20" / "Ended Nov 3", or '' if the block never ends. */
export function endSummary(b: Repeating, today: string): string {
  const last = repeatLastDate(b);
  return last ? `${last < today ? 'Ended' : 'Until'} ${shortDate(last, today)}` : '';
}
