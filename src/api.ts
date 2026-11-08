import type { Doc, SyncPayload } from '../shared/types';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, (body as any).error || `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  me: () => req<{ ok: true }>('/api/me'),
  login: (email: string, password: string, remember: boolean) =>
    req<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) }),
  logout: () => req<{ ok: true }>('/api/logout', { method: 'POST', body: '{}' }),
  state: () => req<Doc>('/api/state'),
  sync: (p: SyncPayload, keepalive = false) => req<{ ok: true }>('/api/sync', { method: 'POST', body: JSON.stringify(p), keepalive })
};
