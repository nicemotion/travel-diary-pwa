// router.js — piccolo router hash-based (#/trips/3?sort=location) per sostituire le rotte Flask

import { icon } from './icons.js';

const routes = [];

export function route(pattern, handler) {
  // pattern tipo '/entry/:id' -> regex con gruppi nominati
  const paramNames = [];
  const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp('^' + regexStr + '$');
  routes.push({ regex, paramNames, handler });
}

function parseHash() {
  let hash = location.hash.slice(1) || '/';
  let [path, queryStr] = hash.split('?');
  if (!path) path = '/';
  const query = {};
  if (queryStr) {
    for (const pair of queryStr.split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { path, query };
}

export function navigate(hash) {
  location.hash = hash;
}

export function buildQuery(obj) {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? '?' + parts.join('&') : '';
}

async function render() {
  const { path, query } = parseHash();

  const topbarTitle = document.getElementById('topbar-title');
  const topbarActions = document.getElementById('topbar-actions');
  const topbarBack = document.getElementById('topbar-back');
  const content = document.getElementById('content');

  topbarBack.innerHTML = path === '/'
    ? ''
    : `<a href="javascript:void(0)" onclick="history.back()" class="icon-btn" title="back" aria-label="back">${icon('back')}</a>`;

  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });

      content.innerHTML = '<p class="empty-state">loading...</p>';
      try {
        const view = await r.handler(params, query);
        topbarTitle.textContent = view.title || 'Travel Diary';
        topbarActions.innerHTML = view.actions || '';
        content.innerHTML = view.body || '';
        if (view.mount) view.mount(content);
      } catch (err) {
        console.error(err);
        content.innerHTML = `<p class="empty-state">errore: ${err.message}</p>`;
      }
      updateBottomNav(path);
      window.scrollTo(0, 0);
      return;
    }
  }
  content.innerHTML = '<p class="empty-state">pagina non trovata.</p>';
}

function updateBottomNav(path) {
  document.querySelectorAll('.bottomnav a[data-nav]').forEach((a) => {
    const group = a.getAttribute('data-nav');
    const isActive =
      (group === 'diario' && path === '/') ||
      (group === 'viaggi' && path.startsWith('/trips')) ||
      (group === 'esplora' && (path.startsWith('/countries') || path.startsWith('/tags')));
    a.classList.toggle('active', isActive);
  });
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  window.addEventListener('load', render);
  if (document.readyState !== 'loading') render();
}
