// js/views/dashboard.js — Main dashboard: characters + sessions

import { characters, sessions } from '../api.js';
import { getState }             from '../store.js';
import { toast, esc, avatarEl, statusPill, relativeTime } from '../ui.js';
import { navigate }             from '../router.js';

export async function renderDashboard() {
  const app  = document.getElementById('app');
  const user = getState('user');

  showTopbar('dashboard');
  app.innerHTML = `
    <div class="page">
      <div class="page-header flex justify-between items-center">
        <div>
          <div class="page-title">Campaign Hub</div>
          <div class="page-subtitle">Your characters and sessions, ${esc(user?.displayName || '')}</div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="btn-join-session">Join Session</button>
          <button class="btn btn-primary"  id="btn-create-session">+ New Session</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-8)">
        <!-- Characters column -->
        <div>
          <div class="flex justify-between items-center" style="margin-bottom:var(--sp-4)">
            <span class="card-title" style="margin:0">My Characters</span>
            <button class="btn btn-ghost" id="btn-add-character" style="font-size:0.7rem">+ Add Character</button>
          </div>
          <div id="characters-list">
            <div class="empty-state">
              <div class="empty-state-icon">⚔️</div>
              <div class="empty-state-title">Loading…</div>
            </div>
          </div>
        </div>

        <!-- Sessions column -->
        <div>
          <div class="flex justify-between items-center" style="margin-bottom:var(--sp-4)">
            <span class="card-title" style="margin:0">My Sessions</span>
          </div>
          <div id="sessions-list">
            <div class="empty-state">
              <div class="empty-state-icon">🗺️</div>
              <div class="empty-state-title">Loading…</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // Wire buttons
  document.getElementById('btn-add-character').addEventListener('click', () => navigate('/characters/import'));
  document.getElementById('btn-create-session').addEventListener('click', () => navigate('/sessions/create'));
  document.getElementById('btn-join-session').addEventListener('click', showJoinModal);

  // Load data in parallel
  const [charList, dmSessionList, playerSessionList] = await Promise.allSettled([
    characters.list(),
    sessions.mySessions(),
    sessions.joinedSessions(),
  ]);

  renderCharacters(charList.status === 'fulfilled' ? charList.value : []);

  // Merge DM + player sessions, tag each with role, deduplicate by id
  const dmSessions     = (dmSessionList.status     === 'fulfilled' ? dmSessionList.value     : []).map(s => ({ ...s, role: 'dm' }));
  const joinedSessions = (playerSessionList.status === 'fulfilled' ? playerSessionList.value : []).map(s => ({ ...s, role: 'player' }));
  const seen = new Set(dmSessions.map(s => s.id));
  const allSessions = [...dmSessions, ...joinedSessions.filter(s => !seen.has(s.id))];
  allSessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  renderSessions(allSessions);
}

// ── Characters panel ──────────────────────────────────────────────

function renderCharacters(chars) {
  const el = document.getElementById('characters-list');
  if (!el) return;

  if (!chars.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚔️</div>
        <div class="empty-state-title">No characters yet</div>
        <div class="empty-state-hint">Import from D&amp;D Beyond or create one manually</div>
        <button class="btn btn-primary" style="margin-top:var(--sp-5)" onclick="location.hash='#/characters/import'">
          Add Character
        </button>
      </div>`;
    return;
  }

  el.innerHTML = `<div class="character-grid">
    ${chars.map(c => characterCard(c)).join('')}
  </div>`;

  el.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', () => navigate(`/characters/${card.dataset.id}`));
  });
}

function characterCard(c) {
  const lvlClass = `Lv.${c.level} ${esc(c.className || '—')}`;
  const source   = (c.importSource || 'manual').toLowerCase();
  const sourceLabel = { ddb_api: 'D&D Beyond', pdf: 'PDF', manual: 'Manual' }[source] || source;

  return `
    <div class="character-card" data-id="${esc(c.id)}">
      <span class="import-badge ${source}">${sourceLabel}</span>
      <div class="character-card-header">
        ${avatarEl(c)}
        <div>
          <div class="character-name">${esc(c.name)}</div>
          <div class="character-class">${esc(lvlClass)}${c.race ? ` · ${esc(c.race)}` : ''}</div>
        </div>
      </div>
      <div class="character-stats">
        <div class="stat-chip">
          <span class="stat-chip-label">HP</span>
          <span class="stat-chip-value">${c.maxHp ?? '—'}</span>
        </div>
        <div class="stat-chip">
          <span class="stat-chip-label">AC</span>
          <span class="stat-chip-value">${c.armorClass ?? '—'}</span>
        </div>
        <div class="stat-chip">
          <span class="stat-chip-label">Speed</span>
          <span class="stat-chip-value">${c.speed}ft</span>
        </div>
      </div>
    </div>`;
}

// ── Sessions panel ────────────────────────────────────────────────

function renderSessions(sessionList) {
  const el = document.getElementById('sessions-list');
  if (!el) return;

  if (!sessionList.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🗺️</div>
        <div class="empty-state-title">No sessions yet</div>
        <div class="empty-state-hint">Create a session as DM or join one with a code</div>
        <button class="btn btn-primary" style="margin-top:var(--sp-5)" onclick="location.hash='#/sessions/create'">
          Create Session
        </button>
      </div>`;
    return;
  }

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:var(--sp-3)">
    ${sessionList.map(s => sessionCard(s)).join('')}
  </div>`;

  el.querySelectorAll('.session-card').forEach(card => {
    card.addEventListener('click', () => {
      const status = card.dataset.status;
      if (status === 'ACTIVE' || status === 'LOBBY') {
        const role = card.dataset.role === 'player' ? 'play' : 'dm';
        navigate(`/session/${card.dataset.code}/${role}`);
      }
    });
  });
}

function sessionCard(s) {
  const roleLabel = s.role === 'player' ? `<span style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Player</span>` : '';
  return `
    <div class="session-card" data-id="${esc(s.id)}" data-code="${esc(s.inviteCode)}" data-status="${esc(s.status)}" data-role="${esc(s.role || 'dm')}">
      <div class="session-code">${esc(s.inviteCode)}</div>
      <div class="session-info">
        <div class="session-name">${esc(s.name)} ${roleLabel}</div>
        <div class="session-meta">${esc(s.dmName)} · ${relativeTime(s.createdAt)}</div>
      </div>
      ${statusPill(s.status)}
    </div>`;
}

// ── Join modal ────────────────────────────────────────────────────

function showJoinModal() {
  const existing = document.getElementById('join-modal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'join-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.7);
    display:flex;align-items:center;justify-content:center;z-index:500`;

  modal.innerHTML = `
    <div class="card" style="width:360px;padding:var(--sp-8)">
      <div class="card-title">Join a Session</div>
      <div class="field" style="margin-top:var(--sp-4)">
        <label for="join-code">Invite Code</label>
        <input id="join-code" type="text" placeholder="WOLF-4271"
          style="text-transform:uppercase;letter-spacing:0.1em;font-family:var(--font-mono)"
          maxlength="10">
      </div>
      <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-5)">
        <button class="btn btn-ghost" id="join-cancel">Cancel</button>
        <button class="btn btn-primary" style="flex:1" id="join-confirm">Find Session</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  document.getElementById('join-code').focus();

  document.getElementById('join-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('join-confirm').addEventListener('click', async () => {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!code) return;
    modal.remove();
    navigate(`/session/${code}/join`);
  });

  document.getElementById('join-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('join-confirm').click();
  });
}

// ── Topbar helper (shared by multiple views) ──────────────────────

export function showTopbar(activePage) {
  const topbar     = document.getElementById('topbar');
  const linksEl    = document.getElementById('topbar-links');
  const userEl     = document.getElementById('topbar-user');
  const user       = getState('user');

  topbar.hidden = false;
  document.body.classList.add('has-topbar');

  linksEl.innerHTML = `
    <a href="#/dashboard" class="topbar-link ${activePage === 'dashboard' ? 'active' : ''}">Hub</a>
    <a href="#/characters/import" class="topbar-link ${activePage === 'characters' ? 'active' : ''}">Characters</a>
    <a href="#/sessions/create"   class="topbar-link ${activePage === 'sessions'   ? 'active' : ''}">Sessions</a>`;

  const initials = (user?.displayName || '?')
    .split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();

  userEl.innerHTML = `
    <div class="avatar-chip" id="user-menu-btn">
      <div class="avatar-circle">${initials}</div>
      <span class="avatar-name">${esc(user?.displayName || '')}</span>
    </div>`;

  document.getElementById('user-menu-btn')?.addEventListener('click', showUserMenu);
}

function showUserMenu(e) {
  const existing = document.getElementById('user-dropdown');
  if (existing) { existing.remove(); return; }

  const btn  = e.currentTarget;
  const rect = btn.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.id = 'user-dropdown';
  menu.style.cssText = `
    position:fixed;
    top:${rect.bottom + 6}px;right:${window.innerWidth - rect.right}px;
    background:var(--bg-elevated);border:1px solid var(--border-lit);
    border-radius:var(--radius-lg);padding:var(--sp-2);
    min-width:180px;z-index:500;
    box-shadow:var(--shadow-lg);
    animation:page-in 0.15s var(--ease-out) both`;

  menu.innerHTML = `
    <a href="#/dashboard" class="topbar-link" style="display:block;padding:var(--sp-3) var(--sp-4)">Dashboard</a>
    <hr style="border:none;border-top:1px solid var(--border);margin:var(--sp-2) 0">
    <button id="btn-logout" class="topbar-link btn-danger"
      style="width:100%;text-align:left;display:block;padding:var(--sp-3) var(--sp-4);
             font-family:var(--font-display);font-size:0.72rem;letter-spacing:0.1em;
             text-transform:uppercase;cursor:pointer;border:none;background:none;
             color:var(--red-bright)">
      Sign Out
    </button>`;

  document.body.appendChild(menu);

  document.addEventListener('click', () => menu.remove(), { once: true, capture: true });

  document.getElementById('btn-logout').addEventListener('click', () => {
    import('../store.js').then(({ clearAuth }) => {
      clearAuth();
      navigate('/login');
    });
  });
}
