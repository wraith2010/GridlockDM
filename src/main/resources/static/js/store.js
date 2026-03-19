// js/store.js — Lightweight reactive state store

const listeners = {};
const state = {
  user:       null,   // { id, email, displayName, avatarUrl, role }
  token:      null,   // JWT string
  session:    null,   // current session object
  roster:     [],     // SessionCharacterDto[]
  initiative: [],     // ordered initiative list
  invites:    [],     // pending join requests (DM only)
};

export function getState(key) {
  return key ? state[key] : { ...state };
}

export function setState(key, value) {
  state[key] = value;
  emit(key, value);
}

export function subscribe(key, fn) {
  if (!listeners[key]) listeners[key] = new Set();
  listeners[key].add(fn);
  return () => listeners[key].delete(fn);   // returns unsubscribe fn
}

function emit(key, value) {
  listeners[key]?.forEach(fn => fn(value));
}

// ── Token persistence ──────────────────────────────────────────────
export function persistAuth(token, user) {
  localStorage.setItem('glock_token', token);
  localStorage.setItem('glock_user', JSON.stringify(user));
  setState('token', token);
  setState('user', user);
}

export function loadPersistedAuth() {
  const token = localStorage.getItem('glock_token');
  const raw   = localStorage.getItem('glock_user');
  if (token && raw) {
    try {
      const user = JSON.parse(raw);
      setState('token', token);
      setState('user', user);
      return true;
    } catch { /* bad JSON */ }
  }
  return false;
}

export function clearAuth() {
  localStorage.removeItem('glock_token');
  localStorage.removeItem('glock_user');
  setState('token', null);
  setState('user', null);
  setState('session', null);
  setState('roster', []);
  setState('invites', []);
}

export function isAuthenticated() {
  return !!getState('token');
}
