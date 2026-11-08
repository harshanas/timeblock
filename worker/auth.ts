// Single-user auth: PBKDF2 password hash in a secret + HMAC-signed session token in a cookie.

const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = (buf: ArrayBuffer) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** PASSWORD_HASH format: pbkdf2$sha256$<iterations>$<saltB64>$<hashB64> */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  const salt = unb64(parts[3]);
  const expected = unb64(parts[4]);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8);
  return timingSafeEqual(new Uint8Array(bits), expected);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function emailMatches(given: string, expected: string): Promise<boolean> {
  // Hash both sides so comparison time doesn't depend on where they differ.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given.trim().toLowerCase())),
    crypto.subtle.digest('SHA-256', enc.encode(expected.trim().toLowerCase()))
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

export async function makeToken(secret: string, ttlSeconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `v1.${exp}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function checkToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const [v, expStr] = payload.split('.');
  if (v !== 'v1' || !(Number(expStr) > Date.now() / 1000)) return false;
  const good = await hmac(secret, payload);
  return timingSafeEqual(enc.encode(sig), enc.encode(good));
}
