// js/views/game.js — Game view shell (DM, Player, Observer)

import { sessions }     from '../api.js';
import { getState, setState } from '../store.js';
import { toast, esc, conditionBadges, hpBar, initials } from '../ui.js';
import { navigate }     from '../router.js';
import * as ws          from '../ws.js';
import { Renderer, ZONE_TYPES } from '../canvas/renderer.js';

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

  // Load existing map if already uploaded
  if (session.mapImageUrl) {
    renderer.loadMap(session.mapImageUrl, session.gridConfig);
    if (session.zones)    renderer.updateZones(session.zones);
    if (session.fogState) renderer.updateFog(session.fogState);
  }

  // Load persisted spell overlays (DM sees all)
  if (session.activeOverlays?.length) {
    session.activeOverlays.forEach(o => renderer.addSpellOverlay(o));
  }

  // Load roster
  await refreshRoster(session.id, renderer);

  // DM-specific: pending invites panel
  await refreshPendingInvites(session.id);

  // Wire DM controls (returns callbacks needed by bindSessionEvents)
  const dmCallbacks = wireDmControls(session, renderer, code);

  // Wire WebSocket
  ws.connect(code);
  bindSessionEvents(renderer, code, 'dm', dmCallbacks);

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

  if (session.mapImageUrl) {
    renderer.loadMap(session.mapImageUrl, session.gridConfig);
    if (session.zones)    renderer.updateZones(session.zones);
    if (session.fogState) renderer.updateFog(session.fogState);
  }

  // Load persisted spell overlays (players only see 'everyone' overlays)
  if (session.activeOverlays?.length) {
    session.activeOverlays
      .filter(o => o.visibility === 'everyone')
      .forEach(o => renderer.addSpellOverlay(o));
  }

  await refreshRoster(session.id, renderer);

  // Identify this player's own token so they can drag it
  const myUserId = getState('user')?.id;
  const mySc = (getState('roster') || []).find(sc => sc.playerId === myUserId);
  if (mySc) { renderer.myTokenId = mySc.id; setState('myTokenId', mySc.id); }

  // Show/hide place-token button based on whether the token is on the map
  const syncPlaceBtn = () => {
    const btn   = document.getElementById('btn-place-my-token');
    if (!btn) return;
    const myId  = renderer.myTokenId;
    const roster = getState('roster') || [];
    const sc    = roster.find(r => r.id === myId);
    btn.style.display = (myId && sc && sc.positionX == null) ? 'block' : 'none';
  };
  syncPlaceBtn();

  const startPlaceMyToken = () => {
    if (!renderer.myTokenId) { toast('Your character hasn\'t joined yet.', 'info'); return; }
    renderer.startPlacement(renderer.myTokenId);
    toast('Click on the map to place your token. Escape to cancel.', 'info', 5000);
  };

  document.getElementById('btn-place-my-token')?.addEventListener('click', startPlaceMyToken);

  // Broadcast token movement when player drags or places their own token
  renderer.on('tokenMoved', ({ tokenId, x, y }) => {
    ws.send('MOVE_TOKEN', { tokenId, x, y });
    // Once placed, hide the button
    if (tokenId === renderer.myTokenId) syncPlaceBtn();
  });

  // "Place on Map" button in the roster entry (kept as fallback)
  document.getElementById('roster-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-place-token]');
    if (!btn) return;
    const tokenId = btn.dataset.placeToken;
    if (tokenId !== renderer.myTokenId) return;
    renderer.startPlacement(tokenId);
    toast('Click on the map to place your token. Escape to cancel.', 'info', 5000);
  });

  // Wire player spell controls (returns callbacks for WS events)
  const playerCallbacks = wirePlayerSpellControls(session, renderer);

  ws.connect(code);
  bindSessionEvents(renderer, code, 'player', playerCallbacks);

  // If own token joins mid-session (PLAYER_JOINED WS event sets myTokenId)
  ws.on('PLAYER_JOINED', (sc) => {
    if (sc.playerId === myUserId) { renderer.myTokenId = sc.id; setState('myTokenId', sc.id); syncPlaceBtn(); }
  });

  // Escape cancels placement
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      renderer.cancelPlacement();
      renderer.cancelSpellPlacement();
    }
  });

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

  const canvas   = document.getElementById('game-canvas');
  const renderer = new Renderer(canvas, { role: 'observer', fitToScreen: true });

  // Set observer token so API calls can authenticate
  if (observerToken) setState('token', observerToken);

  // Load initial session state (map, grid, zones, roster)
  const session = await loadSession(code);
  if (session?.mapImageUrl) {
    renderer.loadMap(session.mapImageUrl, session.gridConfig);
    if (session.zones)    renderer.updateZones(session.zones);
    if (session.fogState) renderer.updateFog(session.fogState);
  }
  // Load persisted spell overlays (observers only see 'everyone' overlays)
  if (session?.activeOverlays?.length) {
    session.activeOverlays
      .filter(o => o.visibility === 'everyone')
      .forEach(o => renderer.addSpellOverlay(o));
  }
  if (session) await refreshRoster(session.id, renderer);

  // Connect WS after initial load so events don't race with REST data
  ws.connect(code, observerToken);
  bindSessionEvents(renderer, code, 'observer');

  let observerViewportLocked = false;

  ws.on('DM_VIEWPORT', ({ zoom, panX, panY }) => {
    if (!observerViewportLocked) renderer.setViewport(zoom, panX, panY);
  });

  const btnZoomInch = document.getElementById('btn-zoom-inch');
  const btnFollowDm = document.getElementById('btn-follow-dm');

  btnZoomInch?.addEventListener('click', () => {
    renderer.zoomToInch();
    observerViewportLocked = true;
    if (btnFollowDm) btnFollowDm.style.display = '';
  });

  btnFollowDm?.addEventListener('click', () => {
    observerViewportLocked = false;
    btnFollowDm.style.display = 'none';
  });

  return {
    cleanup: () => { ws.disconnect(); renderer.destroy(); }
  };
}

// ── Shared: bind WebSocket events to renderer ─────────────────────

function bindSessionEvents(renderer, code, role, dmCallbacks = {}) {
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

  ws.on('MAP_LOADED', ({ mapImageUrl, gridConfig }) => {
    renderer.loadMap(mapImageUrl, gridConfig);
  });

  ws.on('MAP_ROTATED', ({ direction }) => {
    if (role !== 'observer') return;
    if (direction === 'left')  renderer.rotateLeft();
    if (direction === 'right') renderer.rotateRight();
  });

  ws.on('GRID_UPDATED', (gridConfig) => {
    renderer.updateGridConfig(gridConfig);
    updateGridPanel(gridConfig);
  });

  ws.on('ZONES_UPDATED', (zones) => {
    renderer.updateZones(zones);
  });

  ws.on('SESSION_ENDED', () => {
    toast('The session has ended.', 'info');
    ws.disconnect();
    setTimeout(() => navigate('/dashboard'), 2000);
  });

  // Spell overlays (broadcast for 'everyone' visibility)
  ws.on('SPELL_OVERLAY_ADDED', (overlay) => {
    renderer.addSpellOverlay(overlay);
    dmCallbacks.refreshSpellOverlayList?.();
  });

  ws.on('SPELL_OVERLAY_REMOVED', ({ id }) => {
    renderer.removeSpellOverlay(id);
    dmCallbacks.refreshSpellOverlayList?.();
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
            <button class="btn btn-ghost" style="justify-content:flex-start;gap:var(--sp-3)" id="tool-spell">
              ✨ Spell Overlay
            </button>
          </div>
        </div>

        <!-- Zone type picker (shown when zone tool active) -->
        <div class="game-panel-section" id="zone-type-picker" style="display:none">
          <div class="game-panel-label">Zone Type</div>
          <div style="display:flex;flex-direction:column;gap:var(--sp-1)">
            ${Object.entries(ZONE_TYPES).map(([key, def]) => `
              <button class="btn btn-ghost${key === 'difficult' ? ' active' : ''}"
                      data-zone-type="${key}"
                      style="justify-content:flex-start;gap:var(--sp-3);font-size:0.75rem">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;
                             background:${def.color};flex-shrink:0"></span>
                ${def.label}
              </button>`).join('')}
          </div>
        </div>

        <!-- Spell overlay panel (shown when spell tool active) -->
        <div class="game-panel-section" id="spell-overlay-panel" style="display:none">
          <div class="game-panel-label">Spell AoE</div>
          <div style="margin-bottom:var(--sp-2)">
            <label style="font-size:0.7rem;color:var(--text-muted)">Preset</label>
            <select id="spell-preset" style="width:100%;margin-top:var(--sp-1);background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
              <option value="">-- custom --</option>
              <option value='{"shape":"circle","label":"Fireball","color":"#e25822","sizeFt":20}'>Fireball (20ft)</option>
              <option value='{"shape":"cone","label":"Burning Hands","color":"#ff4500","sizeFt":15}'>Burning Hands (15ft)</option>
              <option value='{"shape":"cone","label":"Cone of Cold","color":"#87ceeb","sizeFt":60}'>Cone of Cold (60ft)</option>
              <option value='{"shape":"line","label":"Lightning Bolt","color":"#f7d358","sizeFt":100}'>Lightning Bolt (100ft)</option>
              <option value='{"shape":"cube","label":"Thunderwave","color":"#85c1e9","sizeFt":15}'>Thunderwave (15ft)</option>
              <option value='{"shape":"cube","label":"Hypnotic Pattern","color":"#c39bd3","sizeFt":30}'>Hypnotic Pattern (30ft)</option>
              <option value='{"shape":"circle","label":"Spirit Guardians","color":"#f9e79f","sizeFt":15}'>Spirit Guardians (15ft)</option>
              <option value='{"shape":"circle","label":"Silence","color":"#808080","sizeFt":20}'>Silence (20ft)</option>
            </select>
          </div>
          <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)">
            <div style="flex:1">
              <label style="font-size:0.7rem;color:var(--text-muted)">Shape</label>
              <select id="spell-shape" style="width:100%;margin-top:var(--sp-1);background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
                <option value="circle">Circle/Sphere</option>
                <option value="cone">Cone (90°)</option>
                <option value="line">Line</option>
                <option value="cube">Cube/Square</option>
              </select>
            </div>
            <div style="flex:1">
              <label style="font-size:0.7rem;color:var(--text-muted)">Size (ft)</label>
              <input type="number" id="spell-size" value="20" min="5" max="500" step="5"
                     style="width:100%;margin-top:var(--sp-1);background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
            </div>
          </div>
          <div style="margin-bottom:var(--sp-2)">
            <label style="font-size:0.7rem;color:var(--text-muted)">Label</label>
            <input type="text" id="spell-label" placeholder="Spell name" maxlength="30"
                   style="width:100%;margin-top:var(--sp-1);background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
          </div>
          <div style="display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-2)">
            <label style="font-size:0.7rem;color:var(--text-muted)">Color</label>
            <input type="color" id="spell-color" value="#e25822"
                   style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0">
          </div>
          <div style="margin-bottom:var(--sp-3)">
            <label style="font-size:0.7rem;color:var(--text-muted)">Visibility</label>
            <select id="spell-visibility" style="width:100%;margin-top:var(--sp-1);background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
              <option value="everyone">Everyone</option>
              <option value="dm_only">DM Only</option>
            </select>
          </div>
          <button class="btn btn-primary" id="btn-place-spell" style="width:100%;margin-bottom:var(--sp-2)">
            Place on Map
          </button>
          <div class="game-panel-label" style="margin-top:var(--sp-3)">Active Overlays</div>
          <div id="spell-overlay-list" style="display:flex;flex-direction:column;gap:var(--sp-1)"></div>
        </div>

        <!-- Map upload -->
        <div class="game-panel-section">
          <div class="game-panel-label">Battlemap</div>
          <input type="file" id="map-file-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
          <button class="btn btn-ghost" style="width:100%;justify-content:flex-start;gap:var(--sp-3)" id="btn-upload-map">
            🗺 Upload Map
          </button>
          <button class="btn btn-ghost" style="width:100%;justify-content:flex-start;gap:var(--sp-3);margin-top:var(--sp-1)" id="btn-edit-grid">
            ⊞ Edit Grid
          </button>
          <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-1)">
            <button class="btn btn-ghost" style="flex:1;font-size:0.7rem" id="btn-rotate-left"  title="Rotate observer view 90° counter-clockwise">↺ Rotate</button>
            <button class="btn btn-ghost" style="flex:1;font-size:0.7rem" id="btn-rotate-right" title="Rotate observer view 90° clockwise">↻ Rotate</button>
          </div>
        </div>

        <!-- Fog + Zone controls -->
        <div class="game-panel-section">
          <div class="game-panel-label">Visibility</div>
          <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)">
            <button class="btn btn-ghost" style="flex:1;font-size:0.65rem" id="fog-reveal-all">Reveal All</button>
            <button class="btn btn-ghost" style="flex:1;font-size:0.65rem" id="fog-hide-all">Hide All</button>
          </div>
          <button class="btn btn-ghost" style="width:100%;font-size:0.65rem" id="zones-clear-all">Clear All Zones</button>
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

        <!-- Spell AoE overlays -->
        <div class="game-panel-section">
          <div class="game-panel-label">Spell AoE</div>
          <div style="margin-bottom:var(--sp-2)">
            <select id="spell-preset" style="width:100%;background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
              <option value="">-- preset --</option>
              <option value='{"shape":"circle","label":"Fireball","color":"#e25822","sizeFt":20}'>Fireball (20ft)</option>
              <option value='{"shape":"cone","label":"Burning Hands","color":"#ff4500","sizeFt":15}'>Burning Hands (15ft)</option>
              <option value='{"shape":"cone","label":"Cone of Cold","color":"#87ceeb","sizeFt":60}'>Cone of Cold (60ft)</option>
              <option value='{"shape":"line","label":"Lightning Bolt","color":"#f7d358","sizeFt":100}'>Lightning Bolt (100ft)</option>
              <option value='{"shape":"cube","label":"Thunderwave","color":"#85c1e9","sizeFt":15}'>Thunderwave (15ft)</option>
              <option value='{"shape":"cube","label":"Hypnotic Pattern","color":"#c39bd3","sizeFt":30}'>Hypnotic Pattern (30ft)</option>
              <option value='{"shape":"circle","label":"Spirit Guardians","color":"#f9e79f","sizeFt":15}'>Spirit Guardians (15ft)</option>
              <option value='{"shape":"circle","label":"Silence","color":"#808080","sizeFt":20}'>Silence (20ft)</option>
            </select>
          </div>
          <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)">
            <div style="flex:1">
              <select id="spell-shape" style="width:100%;background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
                <option value="circle">Circle</option>
                <option value="cone">Cone (90°)</option>
                <option value="line">Line</option>
                <option value="cube">Cube</option>
              </select>
            </div>
            <div style="flex:1">
              <input type="number" id="spell-size" value="20" min="5" max="500" step="5"
                     placeholder="ft" title="Size in feet"
                     style="width:100%;background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
            </div>
          </div>
          <div style="display:flex;gap:var(--sp-2);align-items:center;margin-bottom:var(--sp-2)">
            <input type="text" id="spell-label" placeholder="Spell name" maxlength="30"
                   style="flex:1;background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2);font-size:0.75rem">
            <input type="color" id="spell-color" value="#e25822"
                   style="width:28px;height:28px;border:none;background:none;cursor:pointer;padding:0;flex-shrink:0">
          </div>
          <button class="btn btn-primary" id="btn-place-spell" style="width:100%;margin-bottom:var(--sp-2)">
            ✨ Cast Spell
          </button>
          <div id="spell-overlay-list" style="display:flex;flex-direction:column;gap:var(--sp-1)"></div>
        </div>

        <div class="game-panel-section" style="flex:1;overflow-y:auto">
          <div class="game-panel-label">My Character</div>
          <button id="btn-place-my-token" class="btn btn-primary"
                  style="width:100%;margin-bottom:var(--sp-3);display:none">
            📍 Place My Token
          </button>
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
        <div style="position:absolute;bottom:var(--sp-4);right:var(--sp-4);
                    z-index:10;display:flex;gap:var(--sp-2)">
          <button id="btn-follow-dm" class="btn btn-ghost"
                  title="Resume following the DM's viewport"
                  style="display:none;opacity:0.75;font-size:0.7rem;padding:var(--sp-2) var(--sp-4)">
            ↩ Follow DM
          </button>
          <button id="btn-zoom-inch" class="btn btn-ghost"
                  title="Zoom so each grid square is ~1 inch on screen"
                  style="opacity:0.75;font-size:0.7rem;padding:var(--sp-2) var(--sp-4)">
            1&Prime; grid
          </button>
        </div>
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

function renderRoster(roster, myTokenId = getState('myTokenId') ?? null) {
  const el = document.getElementById('roster-list');
  if (!el) return;
  el.innerHTML = roster.map(sc => rosterEntry(sc, myTokenId)).join('');

  // DM: clicking a token in roster opens condition editor
  el.querySelectorAll('.roster-entry[data-token-id]').forEach(entry => {
    entry.addEventListener('click', () => openTokenPanel(entry.dataset.tokenId));
  });
}

function rosterEntry(sc, myTokenId = null) {
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
      ${sc.positionX == null && (myTokenId === null || sc.id === myTokenId) ? `
      <button class="btn btn-ghost" data-place-token="${esc(sc.id)}"
              style="width:100%;margin-top:var(--sp-2);font-size:0.7rem;
                     border:1px dashed var(--border);color:var(--gold)">
        📍 Place on Map
      </button>` : ''}
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

function updateRosterPosition(tokenId, x, y) {
  const roster = (getState('roster') || []).map(sc =>
    sc.id === tokenId ? { ...sc, positionX: x, positionY: y } : sc);
  setState('roster', roster);
  renderRoster(roster);
}

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

// ── Player Spell Controls ─────────────────────────────────────────

function wirePlayerSpellControls(session, renderer) {
  const currentUserId = getState('user')?.id;

  // Preset auto-fills shape/label/color/size
  document.getElementById('spell-preset')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    try {
      const p = JSON.parse(e.target.value);
      document.getElementById('spell-shape').value = p.shape;
      document.getElementById('spell-label').value = p.label;
      document.getElementById('spell-color').value = p.color;
      document.getElementById('spell-size').value  = p.sizeFt;
    } catch { /* ignore */ }
  });

  // Active overlay list — shows only overlays the player created
  const refreshSpellOverlayList = () => {
    const list = document.getElementById('spell-overlay-list');
    if (!list) return;
    const mine = renderer.spellOverlays.filter(o => o.createdBy === currentUserId);
    if (!mine.length) {
      list.innerHTML = '<div style="font-size:0.72rem;color:var(--text-muted)">No active spells</div>';
      return;
    }
    list.innerHTML = mine.map(o => `
      <div style="display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);
                  background:var(--bg-raised);border:1px solid var(--border-dim);border-radius:var(--radius-sm)">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
                     background:${esc(o.color || '#888')};flex-shrink:0"></span>
        <span style="flex:1;font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${esc(o.label || o.shape)} <span style="color:var(--text-muted)">${o.sizeFt}ft</span>
        </span>
        <button class="btn btn-ghost" data-remove-overlay="${esc(o.id)}"
                style="font-size:0.7rem;padding:2px 6px;color:var(--red-bright)" title="Dismiss">✕</button>
      </div>`).join('');

    list.querySelectorAll('[data-remove-overlay]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const overlayId = btn.dataset.removeOverlay;
        try {
          await sessions.removeSpellOverlay(session.id, overlayId);
          renderer.removeSpellOverlay(overlayId);
          refreshSpellOverlayList();
          toast('Spell dismissed', 'info');
        } catch (err) { toast(err.message || 'Failed to dismiss spell', 'error'); }
      });
    });
  };

  // Cast Spell button — enter placement mode
  document.getElementById('btn-place-spell')?.addEventListener('click', () => {
    const shape  = document.getElementById('spell-shape')?.value || 'circle';
    const label  = document.getElementById('spell-label')?.value.trim() || '';
    const color  = document.getElementById('spell-color')?.value || '#e25822';
    const sizeFt = parseInt(document.getElementById('spell-size')?.value, 10) || 20;
    const template = { shape, label, color, sizeFt, visibility: 'everyone' };

    const needsDir = shape === 'cone' || shape === 'line';
    toast(
      needsDir
        ? 'Click to set origin, then click to set direction. Escape to cancel.'
        : 'Click on the map to place. Escape to cancel.',
      'info', 5000
    );

    renderer.startSpellPlacement(template, async (overlay) => {
      try {
        overlay.createdBy = getState('user')?.id;   // stamp locally so list filter works before WS echo
        await sessions.addSpellOverlay(session.id, overlay);
        renderer.addSpellOverlay(overlay);   // optimistic add; WS event deduplicates
        refreshSpellOverlayList();
        toast(`${overlay.label || 'Spell'} cast!`, 'success');
      } catch (err) { toast(err.message || 'Failed to cast spell', 'error'); }
    });
  });

  // Show initial list (overlays loaded before connect)
  refreshSpellOverlayList();

  return { refreshSpellOverlayList };
}

// ── DM Controls ───────────────────────────────────────────────────

function wireDmControls(session, renderer, code) {
  // Tool switching
  const tools = { move: 'move', fog: 'fog', zone: 'zone', ruler: 'ruler', spell: 'spell' };
  Object.entries(tools).forEach(([key, mode]) => {
    document.getElementById(`tool-${key}`)?.addEventListener('click', () => {
      document.querySelectorAll('[id^="tool-"]').forEach(b => b.classList.remove('active'));
      document.getElementById(`tool-${key}`)?.classList.add('active');
      renderer.setTool(mode);
    });
  });

  // Fog controls
  document.getElementById('fog-reveal-all')?.addEventListener('click', async () => {
    try {
      await sessions.revealAllFog(session.id);
      renderer.setFogAll(true);
    } catch (err) { toast(err.message || 'Failed to reveal fog', 'error'); }
  });

  document.getElementById('fog-hide-all')?.addEventListener('click', async () => {
    try {
      await sessions.hideAllFog(session.id);
      renderer.setFogAll(false);
    } catch (err) { toast(err.message || 'Failed to hide fog', 'error'); }
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
      if (!res?.observerToken) {
        toast('Failed to generate observer link — no token returned', 'error');
        return;
      }
      const url = `${window.location.origin}/#/session/${code}/observe?token=${res.observerToken}`;
      await navigator.clipboard.writeText(url);
      toast('Observer link copied to clipboard! 📺', 'success');
    } catch (err) { toast(err.message || 'Failed to generate link', 'error'); }
  });

  // Copy session code
  document.getElementById('session-code-display')?.addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => toast(`Code ${code} copied!`, 'info'));
  });

  // Map upload
  const mapInput = document.getElementById('map-file-input');
  document.getElementById('btn-upload-map')?.addEventListener('click', () => mapInput?.click());
  mapInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await sessions.uploadMap(session.id, file);
      renderer.loadMap(result.mapImageUrl, result.gridConfig);
      toast('Map uploaded!', 'success');
    } catch (err) {
      toast(err.message || 'Map upload failed', 'error');
    }
    mapInput.value = '';
  });

  // Canvas: token selection → open panel
  renderer.on('tokenSelected', (tokenId) => openTokenPanel(tokenId));

  // Canvas: token moved or placed → broadcast via WS
  renderer.on('tokenMoved', ({ tokenId, x, y }) => {
    ws.send('MOVE_TOKEN', { tokenId, x, y });
  });

  // Roster: "Place on Map" button → enter placement mode
  document.getElementById('roster-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-place-token]');
    if (!btn) return;
    e.stopPropagation();
    renderer.startPlacement(btn.dataset.placeToken);
    toast('Click on the map to place the token. Press Escape to cancel.', 'info', 5000);
  });

  // Escape key cancels token placement and spell placement
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      renderer.cancelPlacement();
      renderer.cancelSpellPlacement();
    }
  });

  // Canvas: fog painted → persist via REST (broadcasts FOG_UPDATED to all clients)
  renderer.on('fogPainted', async (cells) => {
    try {
      await sessions.updateFog(session.id, cells);
    } catch (err) { toast(err.message || 'Fog update failed', 'error'); }
  });

  // Canvas: zones painted → send to server
  renderer.on('zonesPainted', async (zones) => {
    try {
      await sessions.updateZones(session.id, zones);
    } catch (err) { toast(err.message || 'Zone update failed', 'error'); }
  });

  // Clear all zones
  document.getElementById('zones-clear-all')?.addEventListener('click', async () => {
    try {
      await sessions.clearZones(session.id);
      renderer.clearZones();
      toast('All zones cleared', 'success');
    } catch (err) { toast(err.message || 'Failed to clear zones', 'error'); }
  });

  // Tool switching shows/hides zone picker and spell panel
  document.querySelectorAll('[id^="tool-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const zonePicker  = document.getElementById('zone-type-picker');
      const spellPanel  = document.getElementById('spell-overlay-panel');
      if (zonePicker) zonePicker.style.display  = btn.id === 'tool-zone'  ? 'block' : 'none';
      if (spellPanel) spellPanel.style.display   = btn.id === 'tool-spell' ? 'block' : 'none';
      if (btn.id !== 'tool-spell') renderer.cancelSpellPlacement();
    });
  });

  // Zone type buttons
  document.querySelectorAll('[data-zone-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-zone-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderer.setZoneType(btn.dataset.zoneType);
    });
  });

  // Grid config panel
  document.getElementById('btn-edit-grid')?.addEventListener('click', () => {
    openGridPanel(session, renderer);
  });

  // Observer rotation: DM controls the orientation of the observer window
  document.getElementById('btn-rotate-left')?.addEventListener('click',  () => ws.send('ROTATE_MAP', { direction: 'left' }));
  document.getElementById('btn-rotate-right')?.addEventListener('click', () => ws.send('ROTATE_MAP', { direction: 'right' }));

  // ── Spell overlay wiring ─────────────────────────────────────────

  // Preset selector auto-fills shape/label/color/size fields
  document.getElementById('spell-preset')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    try {
      const p = JSON.parse(e.target.value);
      document.getElementById('spell-shape').value = p.shape;
      document.getElementById('spell-label').value = p.label;
      document.getElementById('spell-color').value = p.color;
      document.getElementById('spell-size').value  = p.sizeFt;
    } catch { /* ignore parse errors */ }
  });

  // Active overlay list — rendered from renderer.spellOverlays
  const refreshSpellOverlayList = () => {
    const list = document.getElementById('spell-overlay-list');
    if (!list) return;
    const overlays = renderer.spellOverlays;
    if (!overlays.length) {
      list.innerHTML = '<div style="font-size:0.72rem;color:var(--text-muted)">No active overlays</div>';
      return;
    }
    list.innerHTML = overlays.map(o => `
      <div style="display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);
                  background:var(--bg-raised);border:1px solid var(--border-dim);border-radius:var(--radius-sm)">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;
                     background:${esc(o.color || '#888')};flex-shrink:0"></span>
        <span style="flex:1;font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${esc(o.label || o.shape)} <span style="color:var(--text-muted)">${o.sizeFt}ft</span>
          ${o.visibility === 'dm_only' ? '<span style="color:var(--gold);font-size:0.65rem"> DM</span>' : ''}
        </span>
        <button class="btn btn-ghost" data-remove-overlay="${esc(o.id)}"
                style="font-size:0.7rem;padding:2px 6px;color:var(--red-bright)" title="Remove">✕</button>
      </div>`).join('');

    list.querySelectorAll('[data-remove-overlay]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const overlayId = btn.dataset.removeOverlay;
        try {
          await sessions.removeSpellOverlay(session.id, overlayId);
          renderer.removeSpellOverlay(overlayId);
          refreshSpellOverlayList();
          toast('Overlay removed', 'info');
        } catch (err) { toast(err.message || 'Failed to remove overlay', 'error'); }
      });
    });
  };

  // Place on Map button — enters placement mode
  document.getElementById('btn-place-spell')?.addEventListener('click', () => {
    const shape      = document.getElementById('spell-shape')?.value || 'circle';
    const label      = document.getElementById('spell-label')?.value.trim() || '';
    const color      = document.getElementById('spell-color')?.value || '#e25822';
    const sizeFt     = parseInt(document.getElementById('spell-size')?.value, 10) || 20;
    const visibility = document.getElementById('spell-visibility')?.value || 'everyone';
    const template   = { shape, label, color, sizeFt, visibility };

    const needsDir = shape === 'cone' || shape === 'line';
    toast(
      needsDir
        ? 'Click to set origin, then click to set direction. Escape to cancel.'
        : 'Click on the map to place. Escape to cancel.',
      'info', 5000
    );

    renderer.startSpellPlacement(template, async (overlay) => {
      try {
        overlay.createdBy = getState('user')?.id;   // stamp locally so list shows overlay before WS echo
        await sessions.addSpellOverlay(session.id, overlay);
        renderer.addSpellOverlay(overlay);   // optimistic; dedup guard prevents double-add from WS
        refreshSpellOverlayList();
        toast(`${overlay.label || 'Overlay'} placed!`, 'success');
      } catch (err) { toast(err.message || 'Failed to place overlay', 'error'); }
    });
  });

  // Show initial overlay list (in case overlays were loaded on page init)
  refreshSpellOverlayList();

  return { refreshSpellOverlayList };
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

// ── Grid config panel ─────────────────────────────────────────────

function normalizeGridCfg(cfg) {
  if (!cfg) return { marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, cols: 20, rows: 15, confidence: 0 };
  if (cfg.marginLeft !== undefined) return cfg;
  // Convert legacy { originX, originY, cellSizePx, cols, rows } → margin format
  return {
    marginLeft:   cfg.originX   || 0,
    marginRight:  0,
    marginTop:    cfg.originY   || 0,
    marginBottom: 0,
    cols:         cfg.cols      || 20,
    rows:         cfg.rows      || 15,
    confidence:   cfg.confidence || 0,
  };
}

function openGridPanel(session, renderer) {
  document.getElementById('grid-panel')?.remove();

  const cfg = normalizeGridCfg(renderer.gridConfig);
  const confidence = cfg.confidence != null ? Math.round(cfg.confidence * 100) : 0;

  const panel = document.createElement('div');
  panel.id = 'grid-panel';
  panel.style.cssText = `
    position:fixed;left:260px;top:var(--topbar-h,0);width:300px;
    background:var(--bg-void);border-right:1px solid var(--border);
    border-bottom:1px solid var(--border);border-radius:0 0 var(--radius) 0;
    z-index:50;padding:var(--sp-5);animation:page-in 0.15s var(--ease-out) both`;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-4)">
      <div style="font-family:var(--font-display);font-weight:700;font-size:0.95rem">Grid Config</div>
      <button class="btn btn-ghost btn-icon" id="close-grid-panel">✕</button>
    </div>
    ${confidence > 0 ? `
    <div style="margin-bottom:var(--sp-4);padding:var(--sp-2) var(--sp-3);
                background:var(--bg-raised);border-radius:var(--radius-sm);
                font-size:0.75rem;color:var(--text-muted)">
      Claude detected grid with <strong style="color:var(--gold)">${confidence}%</strong> confidence
    </div>` : `
    <div style="margin-bottom:var(--sp-4);padding:var(--sp-2) var(--sp-3);
                background:var(--bg-raised);border-radius:var(--radius-sm);
                font-size:0.75rem;color:var(--text-muted)">
      No grid detected — adjust manually
    </div>`}

    ${gridInput('marginLeft',   'Margin Left (px)',   cfg.marginLeft,   0, 500)}
    ${gridInput('marginRight',  'Margin Right (px)',  cfg.marginRight,  0, 500)}
    ${gridInput('marginTop',    'Margin Top (px)',    cfg.marginTop,    0, 500)}
    ${gridInput('marginBottom', 'Margin Bottom (px)', cfg.marginBottom, 0, 500)}
    ${gridInput('cols',         'Columns',            cfg.cols,         1, 100)}
    ${gridInput('rows',         'Rows',               cfg.rows,         1, 100)}

    <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-4)">
      <button class="btn btn-primary" style="flex:1" id="grid-apply">Apply</button>
      <button class="btn btn-ghost"   style="flex:1" id="grid-cancel">Cancel</button>
    </div>`;

  document.body.appendChild(panel);

  // Live preview as sliders move
  panel.querySelectorAll('input[type=range]').forEach(slider => {
    slider.addEventListener('input', () => {
      const span = panel.querySelector(`#val-${slider.id}`);
      if (span) span.textContent = slider.value;
      renderer.updateGridConfig(readGridPanel(panel, cfg));
    });
  });

  document.getElementById('close-grid-panel').addEventListener('click', () => {
    renderer.updateGridConfig(cfg);  // revert
    panel.remove();
  });
  document.getElementById('grid-cancel').addEventListener('click', () => {
    renderer.updateGridConfig(cfg);
    panel.remove();
  });

  document.getElementById('grid-apply').addEventListener('click', async () => {
    const newCfg = readGridPanel(panel, cfg);
    try {
      await sessions.updateGrid(session.id, newCfg);
      renderer.updateGridConfig(newCfg);
      toast('Grid updated!', 'success');
      panel.remove();
    } catch (err) { toast(err.message || 'Grid update failed', 'error'); }
  });
}

function gridInput(id, label, value, min = -500, max = 2000) {
  return `
    <div style="margin-bottom:var(--sp-3)">
      <div style="display:flex;justify-content:space-between;margin-bottom:var(--sp-1)">
        <label style="font-size:0.75rem;color:var(--text-muted)">${label}</label>
        <span id="val-${id}" style="font-family:var(--font-mono);font-size:0.75rem;color:var(--gold)">${value}</span>
      </div>
      <input type="range" id="${id}" min="${min}" max="${max}" value="${value}"
             style="width:100%;accent-color:var(--gold)">
    </div>`;
}

function readGridPanel(panel, defaults) {
  const v = (id) => parseInt(panel.querySelector(`#${id}`)?.value ?? defaults[id] ?? 0, 10);
  return {
    marginLeft:   Math.max(0, v('marginLeft')),
    marginRight:  Math.max(0, v('marginRight')),
    marginTop:    Math.max(0, v('marginTop')),
    marginBottom: Math.max(0, v('marginBottom')),
    cols:         Math.max(1, v('cols')),
    rows:         Math.max(1, v('rows')),
    confidence:   defaults.confidence || 0,
  };
}

function updateGridPanel(gridConfig) {
  const panel = document.getElementById('grid-panel');
  if (!panel) return;
  const cfg = normalizeGridCfg(gridConfig);
  ['marginLeft','marginRight','marginTop','marginBottom','cols','rows'].forEach(key => {
    const input = panel.querySelector(`#${key}`);
    const span  = panel.querySelector(`#val-${key}`);
    if (input && cfg[key] != null) { input.value = cfg[key]; }
    if (span  && cfg[key] != null) { span.textContent = cfg[key]; }
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
