// js/views/session-flow.js — Session create, join, and lobby

import { sessions, characters } from '../api.js';
import { getState, setState }   from '../store.js';
import { toast, setLoading, esc, avatarEl, statusPill } from '../ui.js';
import { navigate }             from '../router.js';
import { showTopbar }           from './dashboard.js';
import * as ws                  from '../ws.js';

// ── Create Session (DM) ───────────────────────────────────────────

export function renderCreateSession() {
  const app = document.getElementById('app');
  showTopbar('sessions');

  app.innerHTML = `
    <div class="page" style="max-width:560px">
      <div class="page-header">
        <a href="#/dashboard" class="btn btn-ghost" style="margin-bottom:var(--sp-4);display:inline-flex">← Back</a>
        <div class="page-title">New Session</div>
        <div class="page-subtitle">Create a session and invite your players</div>
      </div>

      <div class="card card-lg">
        <form id="create-session-form" class="form">
          <div class="field">
            <label for="s-name">Session Name</label>
            <input id="s-name" type="text" placeholder="Temple of the Forsaken God" required maxlength="200">
          </div>

          <div class="field">
            <label>Join Mode</label>
            <div style="display:flex;flex-direction:column;gap:var(--sp-3);margin-top:var(--sp-2)">
              <label class="mode-option" style="display:flex;align-items:flex-start;gap:var(--sp-3);
                cursor:pointer;padding:var(--sp-4);background:var(--bg-raised);
                border:1px solid var(--border);border-radius:var(--radius);transition:border-color 0.15s">
                <input type="radio" name="invite-mode" value="DM_APPROVAL" checked style="margin-top:3px">
                <div>
                  <div style="font-weight:600;color:var(--text-primary);font-size:0.9rem">DM Approval</div>
                  <div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px">
                    Players submit a join request — you accept or deny each one
                  </div>
                </div>
              </label>
              <label class="mode-option" style="display:flex;align-items:flex-start;gap:var(--sp-3);
                cursor:pointer;padding:var(--sp-4);background:var(--bg-raised);
                border:1px solid var(--border);border-radius:var(--radius);transition:border-color 0.15s">
                <input type="radio" name="invite-mode" value="OPEN" style="margin-top:3px">
                <div>
                  <div style="font-weight:600;color:var(--text-primary);font-size:0.9rem">Open</div>
                  <div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px">
                    Anyone with the invite code joins immediately
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div id="create-error" class="field-error" hidden></div>

          <button type="submit" class="btn btn-primary btn-lg btn-full" id="btn-create">
            Create Session
          </button>
        </form>
      </div>
    </div>`;

  document.getElementById('create-session-form').addEventListener('submit', handleCreate);
}

async function handleCreate(e) {
  e.preventDefault();
  const btn    = document.getElementById('btn-create');
  const errEl  = document.getElementById('create-error');
  const name   = document.getElementById('s-name').value.trim();
  const mode   = document.querySelector('input[name="invite-mode"]:checked').value;

  errEl.hidden = true;
  setLoading(btn, true, 'Creating…');

  try {
    const session = await sessions.create(name, mode);
    toast(`Session created! Code: ${session.inviteCode}`, 'success', 6000);
    navigate(`/session/${session.inviteCode}/dm`);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    setLoading(btn, false);
  }
}

// ── Join Session (Player) ─────────────────────────────────────────

export async function renderJoinSession({ code }) {
  const app = document.getElementById('app');
  showTopbar('sessions');

  // First fetch session info (public endpoint)
  let sessionInfo = null;
  try {
    sessionInfo = await sessions.info(code);
  } catch {
    app.innerHTML = `<div class="page" style="text-align:center;padding-top:80px">
      <div class="empty-state-icon">🚪</div>
      <div class="page-title">Session Not Found</div>
      <p class="page-subtitle">The code <strong>${esc(code)}</strong> doesn't match any active session.</p>
      <a href="#/dashboard" class="btn btn-ghost" style="margin-top:var(--sp-6);display:inline-flex">Go Home</a>
    </div>`;
    return;
  }

  if (sessionInfo.status === 'ENDED') {
    app.innerHTML = `<div class="page" style="text-align:center;padding-top:80px">
      <div class="empty-state-icon">🏁</div>
      <div class="page-title">Session Ended</div>
      <p class="page-subtitle">${esc(sessionInfo.name)} has concluded.</p>
      <a href="#/dashboard" class="btn btn-ghost" style="margin-top:var(--sp-6);display:inline-flex">Go Home</a>
    </div>`;
    return;
  }

  // Load player's characters
  let charList = [];
  try { charList = await characters.list(); } catch { /* handled below */ }

  app.innerHTML = `
    <div class="lobby-shell">
      <div class="lobby-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-2)">
          <div class="lobby-title">${esc(sessionInfo.name)}</div>
          ${statusPill(sessionInfo.status)}
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted)">
          DM: ${esc(sessionInfo.dmName)} ·
          ${sessionInfo.inviteMode === 'DM_APPROVAL' ? '⏳ DM must approve your request' : '✅ Open — join instantly'}
        </div>

        <div class="lobby-code">${esc(code)}</div>

        <div style="margin-bottom:var(--sp-5)">
          <div class="game-panel-label">Choose your character</div>
          ${charList.length === 0 ? `
            <div style="text-align:center;padding:var(--sp-6);background:var(--bg-raised);
                 border:1px dashed var(--border);border-radius:var(--radius-lg)">
              <div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:var(--sp-4)">
                You don't have any characters yet
              </div>
              <a href="#/characters/import" class="btn btn-ghost">Add a Character First</a>
            </div>` :
          `<div class="character-grid" id="char-picker" style="grid-template-columns:1fr">
            ${charList.map(c => charPickerRow(c)).join('')}
          </div>`}
        </div>

        <div id="join-error" class="field-error" hidden style="margin-bottom:var(--sp-4)"></div>

        <button class="btn btn-primary btn-lg btn-full" id="btn-join"
          ${charList.length === 0 ? 'disabled' : ''}>
          ${sessionInfo.inviteMode === 'DM_APPROVAL' ? 'Request to Join' : 'Join Session'}
        </button>
      </div>
    </div>`;

  // Character picker selection
  let selectedCharId = charList[0]?.id || null;
  if (selectedCharId) {
    document.querySelector(`[data-char-id="${selectedCharId}"]`)?.classList.add('selected');
  }

  document.getElementById('char-picker')?.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.character-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedCharId = card.dataset.charId;
    });
  });

  document.getElementById('btn-join')?.addEventListener('click', async () => {
    if (!selectedCharId) return;
    const btn   = document.getElementById('btn-join');
    const errEl = document.getElementById('join-error');
    errEl.hidden = true;
    setLoading(btn, true, 'Joining…');

    try {
      const res = await sessions.join(code, selectedCharId);
      if (res.status === 'ACCEPTED') {
        toast('You\'re in! Setting up the battle map…', 'success');
        navigate(`/session/${code}/play`);
      } else {
        toast('Join request sent — waiting for DM approval…', 'info', 8000);
        renderWaitingScreen(code, sessionInfo.name);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      setLoading(btn, false);
    }
  });
}

function charPickerRow(c) {
  return `
    <div class="character-card" data-char-id="${esc(c.id)}"
         style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-4)">
      ${avatarEl(c)}
      <div style="flex:1">
        <div class="character-name">${esc(c.name)}</div>
        <div class="character-class">Lv.${c.level} ${esc(c.className || '—')}${c.race ? ` · ${esc(c.race)}` : ''}</div>
      </div>
      <div class="stat-chip" style="text-align:center;min-width:52px">
        <span class="stat-chip-label">Speed</span>
        <span class="stat-chip-value">${c.speed}ft</span>
      </div>
    </div>`;
}

function renderWaitingScreen(code, sessionName) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="lobby-shell">
      <div class="lobby-card" style="text-align:center">
        <div style="font-size:2rem;margin-bottom:var(--sp-4);animation:dot-pulse 2s ease infinite">⏳</div>
        <div class="lobby-title">${esc(sessionName)}</div>
        <div style="color:var(--text-muted);font-size:0.9rem;margin-top:var(--sp-2)">
          Waiting for the DM to accept your request…
        </div>
        <div class="lobby-code">${esc(code)}</div>
        <div style="font-size:0.82rem;color:var(--text-muted)">
          You'll be taken to the battle map automatically when accepted.
        </div>
      </div>
    </div>`;

  // Connect WebSocket to listen for invite result
  ws.connect(code);
  ws.on('INVITE_RESULT', (payload) => {
    if (payload.status === 'ACCEPTED') {
      toast('The DM accepted you! Entering the battle…', 'success');
      navigate(`/session/${code}/play`);
    } else if (payload.status === 'DENIED') {
      toast('The DM denied your join request.', 'error');
      navigate('/dashboard');
    }
  });
}
