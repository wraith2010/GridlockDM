// js/views/auth.js — Login and Register screens

import { auth }          from '../api.js';
import { persistAuth }   from '../store.js';
import { toast, setLoading } from '../ui.js';
import { navigate }      from '../router.js';

// ── Register ──────────────────────────────────────────────────────

export function renderRegister() {
  const app = document.getElementById('app');
  document.getElementById('topbar').hidden = true;
  document.body.classList.remove('has-topbar');

  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-art">
        <div class="auth-art-pattern"></div>
        <div class="auth-art-hex">
          ${Array.from({ length: 32 }, () => `<div class="auth-art-cell"></div>`).join('')}
        </div>
        <div class="auth-art-title">Gridlock<br>DM</div>
        <div class="auth-art-sub">Real-time battle maps<br>for your D&amp;D sessions</div>
      </div>

      <div class="auth-form-panel">
        <form class="form" id="register-form" style="max-width:380px">
          <div>
            <div class="form-title">Create Account</div>
            <div class="form-subtitle">Join the campaign</div>
          </div>

          <div class="field">
            <label for="r-display">Display Name</label>
            <input id="r-display" type="text" placeholder="How the party knows you" autocomplete="nickname" required>
          </div>

          <div class="field">
            <label for="r-email">Email</label>
            <input id="r-email" type="email" placeholder="you@example.com" autocomplete="email" required>
          </div>

          <div class="field">
            <label for="r-password">Password</label>
            <input id="r-password" type="password" placeholder="8+ characters" autocomplete="new-password" minlength="8" required>
            <span class="field-hint">Minimum 8 characters</span>
          </div>

          <div id="register-error" class="field-error" hidden></div>

          <button type="submit" class="btn btn-primary btn-lg btn-full" id="register-btn">
            Create Account
          </button>

          <div class="divider">or</div>

          <p style="text-align:center;font-size:0.9rem;color:var(--text-muted)">
            Already have an account?
            <a href="#/login">Sign in</a>
          </p>
        </form>
      </div>
    </div>`;

  document.getElementById('register-form').addEventListener('submit', handleRegister);
}

async function handleRegister(e) {
  e.preventDefault();
  const btn      = document.getElementById('register-btn');
  const errEl    = document.getElementById('register-error');
  const display  = document.getElementById('r-display').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const password = document.getElementById('r-password').value;

  errEl.hidden = true;
  setLoading(btn, true, 'Creating account…');

  try {
    const res = await auth.register(email, display, password);
    persistAuth(res.token, res.user);
    toast(`Welcome, ${res.user.displayName}! 🎲`, 'success');
    navigate('/dashboard');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    setLoading(btn, false);
  }
}

// ── Login ─────────────────────────────────────────────────────────

export function renderLogin(_, query = {}) {
  const app = document.getElementById('app');
  document.getElementById('topbar').hidden = true;
  document.body.classList.remove('has-topbar');

  // Pre-fill invite code if coming from a /join/:code redirect
  const joinCode = query.join || '';

  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-art">
        <div class="auth-art-pattern"></div>
        <div class="auth-art-hex">
          ${Array.from({ length: 32 }, () => `<div class="auth-art-cell"></div>`).join('')}
        </div>
        <div class="auth-art-title">Gridlock<br>DM</div>
        <div class="auth-art-sub">Real-time battle maps<br>for your D&amp;D sessions</div>
      </div>

      <div class="auth-form-panel">
        <form class="form" id="login-form" style="max-width:380px">
          <div>
            <div class="form-title">Welcome Back</div>
            <div class="form-subtitle">
              ${joinCode
                ? `Sign in to join session <strong style="color:var(--gold)">${joinCode}</strong>`
                : 'The adventure continues'}
            </div>
          </div>

          <div class="field">
            <label for="l-email">Email</label>
            <input id="l-email" type="email" placeholder="you@example.com" autocomplete="email" required>
          </div>

          <div class="field">
            <label for="l-password">Password</label>
            <input id="l-password" type="password" placeholder="Password" autocomplete="current-password" required>
          </div>

          <div id="login-error" class="field-error" hidden></div>

          <button type="submit" class="btn btn-primary btn-lg btn-full" id="login-btn">Sign In</button>

          <div class="divider">or</div>

          <p style="text-align:center;font-size:0.9rem;color:var(--text-muted)">
            New here?
            <a href="#/register">Create an account</a>
          </p>
        </form>
      </div>
    </div>`;

  const form = document.getElementById('login-form');
  form.addEventListener('submit', (e) => handleLogin(e, joinCode));
}

async function handleLogin(e, joinCode) {
  e.preventDefault();
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');
  const email    = document.getElementById('l-email').value.trim();
  const password = document.getElementById('l-password').value;

  errEl.hidden = true;
  setLoading(btn, true, 'Signing in…');

  try {
    const res = await auth.login(email, password);
    persistAuth(res.token, res.user);
    toast(`Welcome back, ${res.user.displayName}!`, 'success');

    if (joinCode) {
      navigate(`/session/${joinCode}/join`);
    } else {
      navigate('/dashboard');
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    setLoading(btn, false);
  }
}
