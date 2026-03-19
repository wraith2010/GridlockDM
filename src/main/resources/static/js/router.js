// js/router.js — Hash-based SPA router

const routes = [];
let currentCleanup = null;

/**
 * Register a route.
 * @param {string|RegExp} pattern  — e.g. '/dashboard' or /\/session\/(.+)/
 * @param {Function}      handler  — (params, query) => HTMLElement | string | null
 */
export function route(pattern, handler) {
  routes.push({ pattern, handler });
}

/** Navigate programmatically */
export function navigate(path) {
  window.location.hash = '#' + path;
}

/** Start the router — call once on app init */
export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function handleRoute() {
  const raw   = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));

  for (const { pattern, handler } of routes) {
    let params = {};
    let matched = false;

    if (pattern instanceof RegExp) {
      const m = pathPart.match(pattern);
      if (m) { matched = true; params = m.slice(1); }
    } else if (typeof pattern === 'string') {
      // Simple named-param matching: /session/:code → { code: 'WOLF-4271' }
      const regexStr = '^' + pattern.replace(/:([a-zA-Z]+)/g, '([^/]+)') + '$';
      const paramNames = [...pattern.matchAll(/:([a-zA-Z]+)/g)].map(m => m[1]);
      const m = pathPart.match(new RegExp(regexStr));
      if (m) {
        matched = true;
        paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
      }
    }

    if (matched) {
      runHandler(handler, params, query);
      return;
    }
  }

  // 404 fallback
  renderNotFound();
}

function runHandler(handler, params, query) {
  if (currentCleanup) {
    try { currentCleanup(); } catch { /* ignore */ }
    currentCleanup = null;
  }

  const result = handler(params, query);
  if (result && typeof result.cleanup === 'function') {
    currentCleanup = result.cleanup;
  }
}

function renderNotFound() {
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `
      <div class="page" style="text-align:center;padding-top:80px">
        <div class="empty-state-icon">🗺️</div>
        <div class="page-title">Lost in the dungeon</div>
        <p class="page-subtitle" style="margin-top:8px">This path doesn't exist.</p>
        <a href="#/dashboard" class="btn btn-ghost" style="margin-top:24px;display:inline-flex">Back to safety</a>
      </div>`;
  }
}
