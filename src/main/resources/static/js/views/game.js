// js/views/game.js — Game view shell (DM, Player, Observer)

import { sessions }     from '../api.js';
import { getState, setState } from '../store.js';
import { toast, esc, conditionBadges, hpBar, initials } from '../ui.js';
import { navigate }     from '../router.js';
import * as ws          from '../ws.js';
import { Renderer }     from '../canvas/renderer.js';

// ── DM View ───────────────────────────────────────────────────────

export async function renderDmView({ code }) {
  const app = document.getElementById('app');
  document.getElementById('topbar').hidden = true;
  document.body.classList.remove('has-topbar');

  app.innerHTML = dmShell(code);

  const session = await loadSession(code);
  if (!session) return;

  setState('session', session);

  // Init canvas renderer
  const canvas   = document.getElementById('game-canvas');
  const renderer = new Renderer(canvas, { role: 'dm' });

  // Wire WebSocket
  ws.connect(code);
  bindSessionEvents(renderer, code, 'dm');

  // Load roster
  await refreshRoster(session.id, renderer);

  // DM-specific: pending invites panel
  await refreshPendingInvites(session.id);

  // Wire DM controls
  wireDmControls(session, renderer, code);

  return {
    cleanup: () => { ws.disconnect(); renderer.destroy(); }
  };
}

// ── Player View ───────────────────────────────────────────────────

export async function renderPlayerView({ code }) {
  const app = document.getElementById('app');
  document.getElementById('topbar').hidden = true;
  document.body.classList.remove('has-topbar');

  app.innerHTML = playerShell();

  const session = await loadSession(code);
  if (!session) return;

  setState('session', session);

  const canvas   = document.getElementById('game-canvas');
  const renderer = new Renderer(canvas, { role: 'player' });

  ws.connect(code);
  bindSessionEvents(renderer, code, 'player');

  await refreshRoster(session.id, renderer);

  return {
    cleanup: () => { ws.disconnect(); renderer.destroy(); }
  };
}

// ── Observer View ─────────────────────────────────────────────────

export async function renderObserverView({ code }, query) {
  const app = document.getElementById('app');
  document.getElementById('topbar').hidden = true;
  document.body.classList.remove('has-topbar');

  const observerToken = query.token || null;

  app.innerHTML = observerShell();

  // Observers use the token from the URL
  ws.connect(code, observerToken);

  const canvas   = document.getElementById('game-canvas');
  const renderer = new Renderer(canvas, { role: 'observer', fitToScreen: true });

  bindSessionEvents(renderer, code, 'observer');

  // Observer listens for DM viewport broadcasts
  ws.on('DM_VIEWPORT', ({ zoom, panX, panY }) => {
    renderer.setViewport(zoom, panX, panY);
  });

  return {
    cleanup: () => { ws.disconnect(); renderer.destroy(); }
  };
}

// ── Shared: bind WebSocket events to renderer ─────────────────────

function bindSessionEvents(renderer, code, role) {
  ws.on('PLAYER_JOINED', (sc) => {
    updateRosterEntry(sc);
    renderer.addToken(sc);
    toast(`${sc.characterName} joined the battle!`, 'info');
  });

  ws.on('TOKEN_MOVED', ({ tokenId, x, y }) => {
    renderer.moveToken(tokenId, x, y);
    updateRosterPosition(tokenId, x, y);
  });

  ws.on('CONDITIONS_UPDATED', ({ tokenId, conditions }) => {
    renderer.updateConditions(tokenId, conditions);
    updateRosterConditions(tokenId, conditions);
  });

  ws.on('FOG_UPDATED', ({ cells }) => {
    renderer.updateFog(cells);
  });

  ws.on('HP_UPDATED', ({ tokenId, currentHp, maxHp }) => {
    renderer.updateHp(tokenId, currentHp, maxHp);
    updateRosterHp(tokenId, currentHp, maxHp);
  });

  ws.on('INITIATIVE_SET', (order) => {
    setState('initiative', order);
    renderInitiative(order);
  });

  ws.on('TURN_ADVANCED', ({ currentTokenId }) => {
    renderer.setActiveTurn(currentTokenId);
    highlightInitiative(currentTokenId);
  });

  ws.on('OVERLAY_TRIGGERED', (overlay) => {
    renderer.showOverlay(overlay);
  });

  ws.on('SESSION_ENDED', () => {
    toast('The session has ended.', 'info');
    ws.disconnect();
    setTimeout(() => navigate('/dashboard'), 2000);
  });

  // DM only: join requests
  if (role === 'dm') {
    ws.on('JOIN_REQUEST', (invite) => {
      addPendingInvite(invite);
      toast(`${invite.playerName} wants to join with ${invite.characterName}`, 'info', 8000);
    });
  }
}

// ── DM Shell HTML ─────────────────────────────────────────────────

function dmShell(code) {
  return `
    <div class="game-shell dm-layout">

      <!-- Left panel: Tokens + Invites -->
      <div class="game-panel game-panel-left" style="grid-area:left">
        <div class="game-panel-section" style="padding:var(--sp-3) var(--sp-4);
             display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)">
          <span style="font-family:var(--font-display);font-size:0.72rem;font-weight:700;
                       letter-spacing:0.12em;text-transform:uppercase;color:var(--gold)">
            DM Control
          </span>
          <span id="session-code-display"
                style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-muted);
                       cursor:pointer;letter-spacing:0.08em"
                title="Click to copy">${esc(code)}</span>
        </div>

        <!-- Pending invites -->
        <div class="game-panel-section" id="invites-panel" style="display:none">
          <div class="game-panel-label">⏳ Join Requests</div>
          <div id="invites-list" style="display:flex;flex-direction:column;gap:var(--sp-2)"></div>
        </div>

        <!-- DM tools -->
        <div class="game-panel-section">
          <div class="game-panel-label">Tools</div>
          <div style="display:flex;flex-direction:column;gap:var(--sp-2)">
            <button class="btn btn-ghost" style="justify-content:flex-start;gap:var(--sp-3)" id="tool-move">
              ⬡ Move Token
            </button>
            <button class="btn btn-ghost" style="justify-content:flex-start;gap:var(--sp-3)" id="tool-fog">
              🌫 Fog of War
            </button>
            <button class="btn btn-ghost" style="justify-content:flex-start;gap:var(--sp-3)" id="tool-zone">
              ✏️ Draw Zone
            </button>
            <button class="btn btn-ghost" style="justify-content:flex-start;gap:var(--sp-3)" id="tool-ruler">
              📏 Ruler
            </button>
          </div>
        </div>

        <!-- Fog controls -->
        <div class="game-panel-section">
          <div class="game-panel-label">Visibility</div>
          <div style="display:flex;gap:var(--sp-2)">
            <button class="btn btn-ghost" style="flex:1;font-size:0.65rem" id="fog-reveal-all">Reveal All</button>
            <button class="btn btn-ghost" style="flex:1;font-size:0.65rem" id="fog-hide-all">Hide All</button>
          </div>
        </div>

        <!-- Session controls -->
        <div class="game-panel-section" style="margin-top:auto">
          <button class="btn btn-ghost" style="width:100%;justify-content:flex-start;gap:var(--sp-3);margin-bottom:var(--sp-2)"
                  id="btn-observer-link">📺 Generate Observer Link</button>
          <button class="btn btn-danger" style="width:100%;justify-content:flex-start;gap:var(--sp-3)"
                  id="btn-end-session">⏹ End Session</button>
        </div>
      </div>

      <!-- Canvas -->
      <div class="game-canvas-area" id="canvas-container">
        <canvas id="game-canvas"></canvas>
        <div id="canvas-overlay" style="position:absolute;inset:0;pointer-events:none"></div>
      </div>

      <!-- Right panel: Initiative + Roster -->
      <div class="game-panel game-panel-right">
        <div class="game-panel-section">
          <div class="game-panel-label">Initiative Order</div>
          <div id="initiative-list" class="initiative-list"></div>
          <div style="margin-top:var(--sp-3);display:flex;gap:var(--sp-2)">
            <button class="btn btn-ghost" style="flex:1;font-size:0.65rem" id="btn-next-turn">Next Turn →</button>
            <button class="btn btn-ghost" style="flex:1;font-size:0.65rem" id="btn-roll-init">Roll Init</button>
          </div>
        </div>

        <div class="game-panel-section" style="flex:1;overflow-y:auto">
          <div class="game-panel-label">Roster</div>
          <div id="roster-list" style="display:flex;flex-direction:column;gap:var(--sp-3)"></div>
        </div>
      </div>

    </div>`;
}

// ── Player Shell HTML ─────────────────────────────────────────────

function playerShell() {
  return `
    <div class="game-shell player-layout">
      <div class="game-canvas-area" id="canvas-container">
        <canvas id="game-canvas"></canvas>
      </div>
      <div class="game-panel game-panel-right">
        <div class="game-panel-section">
          <div class="game-panel-label">Initiative</div>
          <div id="initiative-list" class="initiative-list"></div>
        </div>
        <div class="game-panel-section" style="flex:1;overflow-y:auto">
          <div class="game-panel-label">My Character</div>
          <div id="roster-list"></div>
        </div>
      </div>
    </div>`;
}

// ── Observer Shell HTML ───────────────────────────────────────────

function observerShell() {
  return `
    <div class="game-shell observer-layout">
      <div class="game-canvas-area" id="canvas-container">
        <canvas id="game-canvas"></canvas>
      </div>
      <div class="initiative-strip" id="initiative-strip">
        <span style="font-family:var(--font-display);font-size:0.65rem;letter-spacing:0.1em;
                     text-transform:uppercase;color:var(--text-muted);margin-right:var(--sp-4)">
          Initiative
        </span>
        <div id="initiative-list" style="display:flex;gap:var(--sp-3)"></div>
      </div>
    </div>`;
}

// ── Roster rendering ──────────────────────────────────────────────

async function refreshRoster(sessionId, renderer) {
  try {
    const roster = await sessions.roster(sessionId);
    setState('roster', roster);
    roster.forEach(sc => renderer.addToken(sc));
    renderRoster(roster);
  } catch { /* session may not have players yet */ }
}

function renderRoster(roster) {
  const el = document.getElementById('roster-list');
  if (!el) return;
  el.innerHTML = roster.map(sc => rosterEntry(sc)).join('');

  // DM: clicking a token in roster opens condition editor
  el.querySelectorAll('.roster-entry[data-token-id]').forEach(entry => {
    entry.addEventListener('click', () => openTokenPanel(entry.dataset.tokenId));
  });
}

function rosterEntry(sc) {
  const hp    = sc.currentHp ?? 0;
  const maxHp = sc.maxHp    ?? 0;
  const hpPct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : null;

  return `
    <div class="roster-entry" data-token-id="${esc(sc.id)}"
         style="cursor:pointer;padding:var(--sp-3) var(--sp-4);background:var(--bg-raised);
                border:1px solid var(--border-dim);border-radius:var(--radius)">
      <div style="display:flex;align-items:center;gap:var(--sp-3)">
        <div class="avatar-circle" style="flex-shrink:0">${initials(sc.characterName)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.9rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(sc.characterName)}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted)">
            ${esc(sc.playerName)} · ${sc.speed}ft
            ${maxHp > 0 ? ` · <span style="color:${hpPct > 50 ? 'var(--green-bright)' : hpPct > 25 ? 'var(--amber)' : 'var(--red-bright)'}">${hp}/${maxHp} HP</span>` : ''}
          </div>
        </div>
      </div>
      ${maxHp > 0 ? `<div style="margin-top:var(--sp-2)">${hpBar(hp, maxHp)}</div>` : ''}
      ${sc.conditions?.length ? `<div style="margin-top:var(--sp-2)">${conditionBadges(sc.conditions)}</div>` : ''}
    </div>`;
}

function updateRosterEntry(sc) {
  const roster = getState('roster') || [];
  const existing = roster.find(r => r.id === sc.id);
  if (!existing) {
    setState('roster', [...roster, sc]);
  }
  renderRoster(getState('roster'));
}

function updateRosterConditions(tokenId, conditions) {
  const roster = (getState('roster') || []).map(sc =>
    sc.id === tokenId ? { ...sc, conditions } : sc);
  setState('roster', roster);
  renderRoster(roster);
}

function updateRosterHp(tokenId, currentHp, maxHp) {
  const roster = (getState('roster') || []).map(sc =>
    sc.id === tokenId ? { ...sc, currentHp, maxHp } : sc);
  setState('roster', roster);
  renderRoster(roster);
}

function updateRosterPosition() { /* position display not shown in roster */ }

// ── Initiative rendering ──────────────────────────────────────────

function renderInitiative(order) {
  const el = document.getElementById('initiative-list');
  if (!el) return;

  const isStrip = el.closest('.initiative-strip');

  if (isStrip) {
    el.innerHTML = order.map(entry => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;
                  padding:var(--sp-2) var(--sp-3);background:var(--bg-raised);
                  border:1px solid ${entry.isCurrent ? 'var(--gold)' : 'var(--border)'};
                  border-radius:var(--radius);min-width:80px;text-align:center">
        <span style="font-family:var(--font-mono);font-size:1rem;color:var(--gold)">${entry.roll}</span>
        <span style="font-size:0.72rem;color:var(--text-secondary);white-space:nowrap">${esc(entry.name)}</span>
      </div>`).join('');
    return;
  }

  el.innerHTML = order.map((entry, i) => `
    <div class="initiative-entry ${entry.isCurrent ? 'current' : ''}">
      <span class="initiative-roll">${entry.roll}</span>
      <div style="flex:1;min-width:0">
        <div class="initiative-name">${esc(entry.name)}</div>
        ${entry.conditions?.length ? conditionBadges(entry.conditions) : ''}
      </div>
      ${entry.isCurrent ? `<span style="color:var(--gold);font-size:0.7rem">▶</span>` : ''}
    </div>`).join('');
}

function highlightInitiative(currentTokenId) {
  const initiative = getState('initiative') || [];
  const updated    = initiative.map(e => ({ ...e, isCurrent: e.tokenId === currentTokenId }));
  setState('initiative', updated);
  renderInitiative(updated);
}

// ── Pending invites (DM) ──────────────────────────────────────────

async function refreshPendingInvites(sessionId) {
  try {
    const invites = await sessions.pendingInvites(sessionId);
    setState('invites', invites);
    invites.forEach(addPendingInvite);
  } catch { /* no pending invites */ }
}

function addPendingInvite(invite) {
  const panel = document.getElementById('invites-panel');
  const list  = document.getElementById('invites-list');
  if (!panel || !list) return;

  panel.style.display = 'block';

  const el = document.createElement('div');
  el.className = 'invite-request';
  el.dataset.inviteId = invite.id;
  el.innerHTML = `
    <div class="invite-info">
      <div class="invite-player">${esc(invite.playerName)}</div>
      <div class="invite-char">${esc(invite.characterName)} · Lv.${invite.characterLevel} ${esc(invite.characterClass || '')}</div>
    </div>
    <button class="btn btn-ghost btn-icon" style="color:var(--green-bright)" data-action="accept" title="Accept">✓</button>
    <button class="btn btn-ghost btn-icon" style="color:var(--red-bright)"   data-action="deny"   title="Deny">✕</button>`;

  el.querySelector('[data-action="accept"]').addEventListener('click', async () => {
    try {
      await sessions.acceptInvite(invite.id);
      el.remove();
      if (!list.children.length) panel.style.display = 'none';
      toast(`${invite.playerName} accepted!`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  el.querySelector('[data-action="deny"]').addEventListener('click', async () => {
    try {
      await sessions.denyInvite(invite.id);
      el.remove();
      if (!list.children.length) panel.style.display = 'none';
    } catch (err) { toast(err.message, 'error'); }
  });

  list.appendChild(el);
}

// ── DM Controls ───────────────────────────────────────────────────

function wireDmControls(session, renderer, code) {
  // Tool switching
  const tools = { move: 'move', fog: 'fog', zone: 'zone', ruler: 'ruler' };
  Object.entries(tools).forEach(([key, mode]) => {
    document.getElementById(`tool-${key}`)?.addEventListener('click', () => {
      document.querySelectorAll('[id^="tool-"]').forEach(b => b.classList.remove('active'));
      document.getElementById(`tool-${key}`)?.classList.add('active');
      renderer.setTool(mode);
    });
  });

  // Fog controls
  document.getElementById('fog-reveal-all')?.addEventListener('click', () => {
    renderer.setFogAll(true);
    ws.send('FOG_REVEAL_ALL', {});
  });

  document.getElementById('fog-hide-all')?.addEventListener('click', () => {
    renderer.setFogAll(false);
    ws.send('FOG_HIDE_ALL', {});
  });

  // Next turn
  document.getElementById('btn-next-turn')?.addEventListener('click', () => {
    ws.send('NEXT_TURN', {});
  });

  // End session
  document.getElementById('btn-end-session')?.addEventListener('click', async () => {
    if (!window.confirm('End this session? Players will be disconnected.')) return;
    try {
      await sessions.end(session.id);
      ws.disconnect();
      navigate('/dashboard');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Observer link
  document.getElementById('btn-observer-link')?.addEventListener('click', async () => {
    try {
      const res = await sessions.observerLink(session.id, 'Table TV');
      const url = `${window.location.origin}/#/session/${code}/observe?token=${res.observerToken}`;
      await navigator.clipboard.writeText(url);
      toast('Observer link copied to clipboard! 📺', 'success');
    } catch (err) { toast(err.message || 'Failed to generate link', 'error'); }
  });

  // Copy session code
  document.getElementById('session-code-display')?.addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => toast(`Code ${code} copied!`, 'info'));
  });

  // Canvas: token selection → open panel
  renderer.on('tokenSelected', (tokenId) => openTokenPanel(tokenId));
}

// ── Token detail panel (DM) ───────────────────────────────────────

function openTokenPanel(tokenId) {
  const roster = getState('roster') || [];
  const sc     = roster.find(r => r.id === tokenId);
  if (!sc) return;

  // Remove any existing panel
  document.getElementById('token-panel')?.remove();

  const CONDITIONS = ['Slowed','Restrained','Prone','Blinded','Invisible',
                      'Incapacitated','Concentrating'];

  const panel = document.createElement('div');
  panel.id = 'token-panel';
  panel.style.cssText = `
    position:fixed;right:280px;top:var(--topbar-h,0);bottom:0;width:280px;
    background:var(--bg-void);border-left:1px solid var(--border);
    overflow-y:auto;z-index:50;padding:var(--sp-5);
    animation:page-in 0.2s var(--ease-out) both`;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-5)">
      <div style="font-family:var(--font-display);font-weight:700;font-size:1rem">${esc(sc.characterName)}</div>
      <button class="btn btn-ghost btn-icon" id="close-token-panel">✕</button>
    </div>

    <div class="game-panel-label">Hit Points</div>
    <div style="display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-5)">
      <input type="number" id="hp-current" value="${sc.currentHp ?? ''}" min="0"
        style="width:70px;text-align:center;font-family:var(--font-mono);font-size:1.2rem">
      <span style="color:var(--text-muted)">/</span>
      <input type="number" id="hp-max" value="${sc.maxHp ?? ''}" min="1"
        style="width:70px;text-align:center;font-family:var(--font-mono);font-size:1.2rem">
      <button class="btn btn-ghost" id="hp-apply">Apply</button>
    </div>

    <div class="game-panel-label">Conditions</div>
    <div style="display:flex;flex-direction:column;gap:var(--sp-2);margin-bottom:var(--sp-5)">
      ${CONDITIONS.map(c => `
        <label style="display:flex;align-items:center;gap:var(--sp-3);cursor:pointer;
                      padding:var(--sp-2) var(--sp-3);border-radius:var(--radius-sm);
                      background:var(--bg-raised);border:1px solid var(--border-dim)">
          <input type="checkbox" data-condition="${c}"
            ${(sc.conditions || []).includes(c) ? 'checked' : ''}>
          <span style="font-size:0.85rem">${esc(c)}</span>
        </label>`).join('')}
    </div>

    <div style="display:flex;gap:var(--sp-2)">
      <button class="btn btn-primary" style="flex:1" id="conditions-apply">Save Conditions</button>
    </div>`;

  document.body.appendChild(panel);

  document.getElementById('close-token-panel').addEventListener('click', () => panel.remove());

  document.getElementById('hp-apply').addEventListener('click', () => {
    const currentHp = parseInt(document.getElementById('hp-current').value, 10) || 0;
    const maxHp     = parseInt(document.getElementById('hp-max').value, 10) || 0;
    ws.send('UPDATE_HP', { tokenId, currentHp, maxHp });
    toast('HP updated', 'success');
  });

  document.getElementById('conditions-apply').addEventListener('click', () => {
    const conditions = [...panel.querySelectorAll('input[data-condition]:checked')]
      .map(cb => cb.dataset.condition);
    ws.send('UPDATE_CONDITIONS', { tokenId, conditions });
    toast('Conditions updated', 'success');
    panel.remove();
  });
}

// ── Session loader ────────────────────────────────────────────────

async function loadSession(code) {
  try {
    return await sessions.info(code);
  } catch (err) {
    const app = document.getElementById('app');
    app.innerHTML = `<div class="page" style="text-align:center;padding-top:80px">
      <div class="empty-state-icon">⚠️</div>
      <div class="page-title">Could not load session</div>
      <p class="page-subtitle">${esc(err.message)}</p>
      <a href="#/dashboard" class="btn btn-ghost" style="margin-top:24px;display:inline-flex">← Dashboard</a>
    </div>`;
    return null;
  }
}
