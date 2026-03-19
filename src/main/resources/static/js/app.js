// js/app.js — Application entry point, router wiring, auth guard

import { route, startRouter, navigate } from './router.js';
import { loadPersistedAuth, isAuthenticated } from './store.js';
import { renderLogin, renderRegister }   from './views/auth.js';
import { renderDashboard }               from './views/dashboard.js';
import { renderCharacterImport }         from './views/character-import.js';
import { renderCreateSession, renderJoinSession } from './views/session-flow.js';
import { renderDmView, renderPlayerView, renderObserverView } from './views/game.js';

// ── Auth guard wrapper ────────────────────────────────────────────

function guarded(handler) {
  return (params, query) => {
    if (!isAuthenticated()) {
      const code = params?.code;
      navigate(code ? `/login?join=${code}` : '/login');
      return;
    }
    return handler(params, query);
  };
}

// ── Route definitions ─────────────────────────────────────────────

// Public routes
route('/login',    renderLogin);
route('/register', renderRegister);

// Auth-protected routes
route('/dashboard',         guarded(renderDashboard));
route('/characters/import', guarded(renderCharacterImport));
route('/sessions/create',   guarded(renderCreateSession));

// Session flow
route('/session/:code/join',    guarded(renderJoinSession));
route('/session/:code/dm',      guarded(renderDmView));
route('/session/:code/play',    guarded(renderPlayerView));

// Observer — read-only, uses token in query string (no account needed)
route('/session/:code/observe', renderObserverView);

// Root redirect
route('/', (_, __) => {
  navigate(isAuthenticated() ? '/dashboard' : '/login');
});

// ── Boot ──────────────────────────────────────────────────────────

loadPersistedAuth();   // restore JWT + user from localStorage if present
startRouter();         // parse current hash and start listening for changes
