import { useCallback, useEffect, useState } from 'react';
import type { Doc } from '../shared/types';
import { api, HttpError } from './api';
import Login from './pages/Login';
import Planner from './pages/Planner';

type Phase = { kind: 'loading' } | { kind: 'login' } | { kind: 'ready'; doc: Doc } | { kind: 'error'; message: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const doc = await api.state();
      if (location.pathname !== '/') history.replaceState(null, '', '/');
      setPhase({ kind: 'ready', doc });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        if (location.pathname !== '/login') history.replaceState(null, '', '/login');
        setPhase({ kind: 'login' });
      } else {
        setPhase({ kind: 'error', message: navigator.onLine ? 'Could not load your planner.' : 'You’re offline. Timeblock needs a connection.' });
      }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toLogin = useCallback(() => {
    history.replaceState(null, '', '/login');
    setPhase({ kind: 'login' });
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* cookie is cleared server-side; ignore network errors */ }
    toLogin();
  }, [toLogin]);

  if (phase.kind === 'login') return <Login onSuccess={load} />;
  if (phase.kind === 'ready') return <Planner initial={phase.doc} onUnauthorized={toLogin} onLogout={logout} />;
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#8E8E93', fontSize: 14 }}>
      {phase.kind === 'loading' ? 'Loading…' : (
        <>
          <span>{phase.message}</span>
          <button onClick={load} className="hv-blue" style={{ border: 'none', background: '#007AFF', color: '#fff', height: 32, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Try Again</button>
        </>
      )}
    </div>
  );
}
