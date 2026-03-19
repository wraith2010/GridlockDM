// js/api.js — HTTP client with JWT, error shaping, and toast integration

import { getState, clearAuth } from './store.js';
import { toast } from './ui.js';

const BASE = '';   // same-origin; Spring Boot serves API + static from :8080

class ApiError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code    = code;
    this.details = details;
  }
}

async function request(method, path, body = null, opts = {}) {
  const token = getState('token');

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const config = {
    method,
    headers,
    ...opts,
  };

  if (body !== null) {
    config.body = JSON.stringify(body);
  }

  const res = await fetch(BASE + path, config);

  if (res.status === 204) return null;   // No Content

  if (res.status === 401) {
    clearAuth();
    window.location.hash = '#/login';
    throw new ApiError('UNAUTHORIZED', 'Session expired. Please log in again.');
  }

  let data;
  try   { data = await res.json(); }
  catch { data = null; }

  if (!res.ok) {
    const msg     = data?.message || `Request failed (${res.status})`;
    const code    = data?.code    || 'API_ERROR';
    const details = data?.details || null;
    throw new ApiError(code, msg, details);
  }

  return data;
}

// ── Multipart (PDF / image upload) ────────────────────────────────
async function upload(path, formData) {
  const token = getState('token');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res  = await fetch(BASE + path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      data?.code    || 'UPLOAD_ERROR',
      data?.message || `Upload failed (${res.status})`,
      data?.details || null
    );
  }
  return data;
}

// ── Auth endpoints ────────────────────────────────────────────────
export const auth = {
  register: (email, displayName, password) =>
    request('POST', '/api/auth/register', { email, displayName, password }),

  login: (email, password) =>
    request('POST', '/api/auth/login', { email, password }),

  me: () => request('GET', '/api/auth/me'),
};

// ── Character endpoints ───────────────────────────────────────────
export const characters = {
  list: () =>
    request('GET', '/api/characters'),

  get: (id) =>
    request('GET', `/api/characters/${id}`),

  createManual: (dto) =>
    request('POST', '/api/characters/manual', dto),

  importDdb: (characterId) =>
    request('POST', '/api/characters/import/ddb', { characterId }),

  importPdf: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return upload('/api/characters/import/pdf', fd);
  },

  update: (id, dto) =>
    request('PUT', `/api/characters/${id}`, dto),

  delete: (id) =>
    request('DELETE', `/api/characters/${id}`),
};

// ── Session endpoints ─────────────────────────────────────────────
export const sessions = {
  create: (name, inviteMode) =>
    request('POST', '/api/sessions', { name, inviteMode }),

  info: (code) =>
    request('GET', `/api/sessions/${code}/info`),

  join: (code, characterId) =>
    request('POST', `/api/sessions/${code}/join`, { characterId }),

  mySessions: () =>
    request('GET', '/api/sessions/my'),

  roster: (id) =>
    request('GET', `/api/sessions/${id}/roster`),

  pendingInvites: (id) =>
    request('GET', `/api/sessions/${id}/invites/pending`),

  acceptInvite: (inviteId) =>
    request('POST', `/api/sessions/invites/${inviteId}/accept`),

  denyInvite: (inviteId) =>
    request('POST', `/api/sessions/invites/${inviteId}/deny`),

  start: (id) =>
    request('POST', `/api/sessions/${id}/start`),

  end: (id) =>
    request('POST', `/api/sessions/${id}/end`),

  observerLink: (id, label) =>
    request('POST', `/api/sessions/${id}/observer-link`, { label }),

  uploadMap: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return upload(`/api/sessions/${id}/map`, fd);
  },
};

export { ApiError };
