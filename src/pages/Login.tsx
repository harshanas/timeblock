import { useEffect, useState, type FormEvent } from 'react';
import { api, HttpError } from '../api';

export function Logo({ size = 72 }: { size?: number }) {
  const k = size / 72;
  return (
    <div style={{ width: size, height: size, borderRadius: 17 * k, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.06),0 8px 24px rgba(0,0,0,0.08)', display: 'grid', gridTemplateColumns: `repeat(2,${14 * k}px)`, gridTemplateRows: `repeat(3,${9 * k}px)`, gap: 3 * k, alignContent: 'center', justifyContent: 'center' }}>
      <span style={{ background: '#007AFF', borderRadius: 3 * k, gridRow: 'span 2' }} />
      <span style={{ background: '#34C759', borderRadius: 3 * k }} />
      <span style={{ background: '#FF9500', borderRadius: 3 * k, gridRow: 'span 2' }} />
      <span style={{ background: '#AF52DE', borderRadius: 3 * k }} />
    </div>
  );
}

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.body.classList.add('login');
    return () => document.body.classList.remove('login');
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setLoading(true);
    try {
      await api.login(email.trim(), password, remember);
      onSuccess();
    } catch (err) {
      setLoading(false);
      setError(err instanceof HttpError ? err.message : 'Could not reach the server. Check your connection.');
    }
  };

  const toggleRemember = (e: React.MouseEvent) => { e.preventDefault(); setRemember(r => !r); };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 20px', letterSpacing: -0.1 }}>
      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Logo />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.6 }}>Sign in to Timeblock</h1>
            <p style={{ margin: 0, fontSize: 15, color: '#6e6e73', lineHeight: '20px' }}>Plan your week, one block at a time.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: `inset 0 0 0 1px ${error ? 'rgba(255,59,48,0.6)' : 'rgba(0,0,0,0.1)'}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'box-shadow .2s' }}>
            <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} placeholder="Email"
              style={{ border: 'none', outline: 'none', background: 'transparent', height: 50, padding: '0 16px', fontSize: 16, borderBottom: '1px solid rgba(0,0,0,0.08)' }} />
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="Password"
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', height: 50, padding: '0 16px', fontSize: 16 }} />
              <button type="button" onClick={() => setShowPw(s => !s)} style={{ border: 'none', background: 'transparent', color: '#007AFF', fontSize: 13, fontWeight: 500, padding: '0 16px', height: 50, cursor: 'pointer' }}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          {error && <div role="alert" style={{ fontSize: 13, color: '#D70015', padding: '0 4px', lineHeight: '18px' }}>{error}</div>}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
              <span onClick={toggleRemember} role="checkbox" aria-checked={remember} style={{ width: 18, height: 18, borderRadius: 5, background: remember ? '#007AFF' : '#fff', boxShadow: `inset 0 0 0 1px ${remember ? '#007AFF' : 'rgba(0,0,0,0.2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}>
                <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: remember ? 1 : 0 }}><path d="M2 5.2 4.2 7.3 8 2.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span onClick={toggleRemember}>Keep me signed in</span>
            </label>
          </div>
          <button type="submit" className="hv-blue" style={{ marginTop: 6, border: 'none', background: loading ? '#5AA6FF' : '#007AFF', color: '#fff', height: 48, borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background .15s' }}>
            {loading ? 'Signing In…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
