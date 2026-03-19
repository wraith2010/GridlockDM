// js/ui.js — Shared UI utilities

// ── Toast notifications ───────────────────────────────────────────
export function toast(message, type = 'info', duration = 4000) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
  stack.appendChild(el);

  const remove = () => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  setTimeout(remove, duration);
  el.addEventListener('click', remove);
}

// ── Loading button state ──────────────────────────────────────────
export function setLoading(btn, loading, text = null) {
  if (loading) {
    btn.disabled = true;
    btn._originalText = btn.textContent;
    btn.classList.add('btn-loading');
    if (text) btn.textContent = text;
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    if (btn._originalText) btn.textContent = btn._originalText;
  }
}

// ── HTML sanitize (bare-minimum for injected text) ────────────────
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HP bar helper ─────────────────────────────────────────────────
export function hpBar(current, max) {
  if (!max) return '';
  const pct    = Math.max(0, Math.min(100, (current / max) * 100));
  const status = pct > 60 ? 'high' : pct > 25 ? 'medium' : 'low';
  return `
    <div class="hp-bar-wrap">
      <div class="hp-bar-fill" data-pct="${status}" style="width:${pct}%"></div>
    </div>`;
}

// ── Avatar initials ───────────────────────────────────────────────
export function initials(name) {
  return (name || '?')
    .split(/[\s\/\-]+/)
    .slice(0, 2)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase();
}

// ── Character avatar element ──────────────────────────────────────
export function avatarEl(char) {
  if (char.avatarUrl) {
    return `<div class="character-avatar"><img src="${esc(char.avatarUrl)}" alt="${esc(char.name)}"></div>`;
  }
  return `<div class="character-avatar">${initials(char.name)}</div>`;
}

// ── Condition badge ───────────────────────────────────────────────
export function conditionBadges(conditions = []) {
  if (!conditions.length) return '';
  return `<div class="conditions">
    ${conditions.map(c => `<span class="condition-badge ${c.toLowerCase()}">${esc(c)}</span>`).join('')}
  </div>`;
}

// ── Status pill ───────────────────────────────────────────────────
export function statusPill(status) {
  return `<span class="status-pill ${status.toLowerCase()}">${status}</span>`;
}

// ── Simple confirm dialog (native for now) ────────────────────────
export function confirm(message) {
  return window.confirm(message);
}

// ── Wait for DOM element (polling) ───────────────────────────────
export function waitFor(selector, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const start = Date.now();
    const iv = setInterval(() => {
      const el2 = document.querySelector(selector);
      if (el2) { clearInterval(iv); resolve(el2); }
      if (Date.now() - start > timeout) { clearInterval(iv); reject(); }
    }, 50);
  });
}

// ── Format date ───────────────────────────────────────────────────
export function relativeTime(isoString) {
  const ms   = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  return new Date(isoString).toLocaleDateString();
}
