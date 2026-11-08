import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { checkToken, emailMatches, makeToken, verifyPassword } from './auth';
import { applySync, clearFailures, isLockedOut, loadDoc, recordFailure } from './db';
import type { SyncPayload } from '../shared/types';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_EMAIL: string;
  PASSWORD_HASH: string;
  SESSION_SECRET: string;
};

const COOKIE = 'tb_session';
const LONG_TTL = 30 * 24 * 3600; // "Keep me signed in"
const SHORT_TTL = 24 * 3600;

const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// Reject cross-site state changes: require JSON bodies on writes (forms can't send them cross-origin without CORS).
app.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !(c.req.header('content-type') || '').includes('application/json')) {
    return c.json({ error: 'Unsupported content type' }, 415);
  }
  await next();
});

app.post('/login', async c => {
  const env = c.env;
  if (!env.ADMIN_EMAIL || !env.PASSWORD_HASH || !env.SESSION_SECRET) {
    return c.json({ error: 'Server is not configured. Set ADMIN_EMAIL, PASSWORD_HASH and SESSION_SECRET.' }, 500);
  }
  const ip = c.req.header('cf-connecting-ip') || 'local';
  if (await isLockedOut(env.DB, ip)) {
    return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  }
  const body = await c.req.json<{ email?: string; password?: string; remember?: boolean }>().catch(() => ({}) as any);
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const [emailOk, pwOk] = await Promise.all([emailMatches(email, env.ADMIN_EMAIL), verifyPassword(password, env.PASSWORD_HASH)]);
  if (!emailOk || !pwOk) {
    await recordFailure(env.DB, ip);
    return c.json({ error: 'Incorrect email or password.' }, 401);
  }
  await clearFailures(env.DB, ip);
  const remember = body.remember !== false;
  const token = await makeToken(env.SESSION_SECRET, remember ? LONG_TTL : SHORT_TTL);
  setCookie(c, COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'Strict', path: '/',
    ...(remember ? { maxAge: LONG_TTL } : {})
  });
  return c.json({ ok: true });
});

app.post('/logout', c => {
  deleteCookie(c, COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// Everything below requires a valid session.
app.use('*', async (c, next) => {
  if (!(await checkToken(c.env.SESSION_SECRET || '', getCookie(c, COOKIE)))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

app.get('/me', c => c.json({ ok: true }));

app.get('/state', async c => c.json(await loadDoc(c.env.DB)));

app.post('/sync', async c => {
  const payload = await c.req.json<SyncPayload>().catch(() => null);
  if (!payload || typeof payload !== 'object') return c.json({ error: 'Bad payload' }, 400);
  await applySync(c.env.DB, payload);
  return c.json({ ok: true });
});

app.notFound(c => c.json({ error: 'Not found' }, 404));

export default app;
