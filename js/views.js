// views.js — all views, English UI strings

import {
  getAll, getById, add, put, remove, getAllByIndex,
  findOrCreateCountry, setEntryTags, getEntryTagNames, deleteEntryCascade, haversineMeters,
} from './db.js';
import { searchEntries } from './search.js';
import { icon } from './icons.js';
import { navigate, buildQuery } from './router.js';
import { getLocation } from './geolocation.js';
import { seedDemoData } from './seed.js';
import { exportBackup, importBackup } from './backup.js';
import { createOfflineTileLayer, planDownloadAroundPoints, downloadTiles } from './tiles.js';
import { noteContentAdded, noteBackupCompleted, snoozeReminder, getReminderState } from './backupReminder.js';
import { exportEntryZip, exportEntryHtml, shareOrDownload, importEntryPackage, commitImportedEntry } from './share.js';

// Leaflet's Icon.Default automatically prepends a detected/merged imagePath
// in front of iconUrl/shadowUrl, which is fragile with a vendored (non-CDN)
// setup and singleton timing. Sidestepping it entirely: a plain L.icon()
// with explicit paths, passed directly to each marker below. L.icon() does
// NOT do any path prepending, so this can't double up.
const pinIcon = L.icon({
  iconUrl: './css/vendor/images/marker-icon.png',
  iconRetinaUrl: './css/vendor/images/marker-icon-2x.png',
  shadowUrl: './css/vendor/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
});

// Wires a button to toggle a Leaflet map container between its normal inline
// size and a true fullscreen overlay (position: fixed, covers the viewport
// regardless of the app's 480px max-width column). Leaflet needs
// invalidateSize() after any container resize, with a short delay so it
// runs after the CSS class change has actually taken effect.
function setupMapFullscreen(map, wrapEl, btn) {
  let savedScrollY = 0;

  function isFullscreen() {
    return wrapEl.classList.contains('map-fullscreen');
  }
  function lockBodyScroll() {
    savedScrollY = window.scrollY;
    document.body.classList.add('map-fullscreen-active');
    document.body.style.top = `-${savedScrollY}px`;
  }
  function unlockBodyScroll() {
    document.body.classList.remove('map-fullscreen-active');
    document.body.style.top = '';
    window.scrollTo(0, savedScrollY);
  }
  function exitFullscreen() {
    if (!isFullscreen()) return;
    wrapEl.classList.remove('map-fullscreen');
    unlockBodyScroll();
    btn.innerHTML = icon('expand');
    btn.title = 'view fullscreen';
    setTimeout(() => map.invalidateSize(), 50);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') exitFullscreen();
  }
  btn.addEventListener('click', () => {
    if (isFullscreen()) {
      exitFullscreen();
      document.removeEventListener('keydown', onKeydown);
    } else {
      wrapEl.classList.add('map-fullscreen');
      lockBodyScroll();
      btn.innerHTML = icon('collapse');
      btn.title = 'exit fullscreen';
      document.addEventListener('keydown', onKeydown);
      setTimeout(() => map.invalidateSize(), 50);
    }
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function matchBadge(type) {
  if (type === 'tag') return '<span class="badge accent">tag</span>';
  if (type === 'title') return '';
  return '<span class="badge">text</span>';
}

// shows what actually matched: the tag name for a tag match, a short quoted
// snippet for a text match. A title match needs nothing extra — the title
// is already shown right above it.
function matchDetail(e) {
  if (e.match_type === 'tag' && e.match_value) {
    return `<br><span class="match-detail match-tag">#${escapeHtml(e.match_value)}</span>`;
  }
  if (e.match_type === 'text' && e.match_value) {
    return `<br><span class="match-detail match-text">&ldquo;${escapeHtml(e.match_value)}&rdquo;</span>`;
  }
  return '';
}

function hint(text) {
  return `<p class="hint">*${escapeHtml(text)}</p>`;
}

function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function openLightbox(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img src="${url}" alt="">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// reverse geocoding: turns gps coordinates into a country/city name, via
// OpenStreetMap's free Nominatim API. Best-effort only — if there's no
// connection or the request fails, we just leave the fields as they were
// (same graceful fallback already used for gps itself).
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1&accept-language=en`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    const country = addr.country || '';
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.hamlet || '';
    return (country || city) ? { country, city } : null;
  } catch {
    return null;
  }
}

// reverse geocoding for a full, human-readable street address (building
// level, zoom=18) rather than just country/city — used to show "what's at
// this pin" under the map on the entry detail page. Requested in English
// (accept-language=en) regardless of the device's own language.
async function reverseGeocodeAddress(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=0&accept-language=en`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}

// ---------- Home ----------

const RADIUS_OPTIONS_KM = [1, 4, 10];
const DEFAULT_RADIUS_KM = 4;

const DOWNLOAD_RADIUS_OPTIONS_KM = [1, 2, 5, 10];

function downloadMapControlsHtml(scopeWord) {
  return `
    <div style="display:flex; gap:6px; align-items:center; margin-top:8px;">
      <label for="download-radius-select" style="font-size:12px; color:var(--text-muted); white-space:nowrap;">coverage</label>
      <select id="download-radius-select" style="flex:1; padding:6px 8px; border:1px solid var(--border); border-radius:8px; font-size:13px; background:#fff; color:var(--text-dark);">
        ${DOWNLOAD_RADIUS_OPTIONS_KM.map((km) => `<option value="${km}"${km === 1 ? ' selected' : ''}>${km} km around each pin</option>`).join('')}
      </select>
    </div>
    <button id="download-map-btn" type="button" class="btn-icon-text" style="background:var(--surface-muted); color:var(--text-dark); border:1px solid var(--border);">${icon('external')} download offline map for this ${scopeWord}</button>`;
}

// returns { html, usedFallback }. usedFallback is true when we DID have gps
// and DID filter by radiusKm, but nothing matched, so the list below is the
// most-recent-entries fallback rather than an actual "nearby" result — the
// caller uses this to relabel the section so it isn't mistaken for nearby.
function nearbyListHtml(entries, countryById, loc, radiusKm) {
  let nearby = [];
  let usedFallback = false;
  if (loc) {
    nearby = entries
      .filter((e) => e.lat != null && e.lon != null)
      .map((e) => ({ entry: e, distance: haversineMeters(loc.lat, loc.lon, e.lat, e.lon) }))
      .filter((x) => x.distance <= radiusKm * 1000)
      .sort((a, b) => a.distance - b.distance);
    if (!nearby.length) usedFallback = true;
  }
  if (!nearby.length) {
    const recent = [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5);
    nearby = recent.map((e) => ({ entry: e, distance: null }));
  }
  if (!nearby.length) {
    return { html: '<p class="empty-state">no entries yet. tap + to create one.</p>', usedFallback: false };
  }
  const html = nearby.map((item) => {
    const c = countryById[item.entry.country_id];
    const meta = [item.distance != null ? Math.round(item.distance) + 'm' : null, c ? c.name : '']
      .filter(Boolean).join(' · ');
    return `<a href="#/entry/${item.entry.id}" class="card"><p class="title">${escapeHtml(item.entry.title)}</p><p class="meta">${escapeHtml(meta)}</p></a>`;
  }).join('');
  return { html, usedFallback };
}

function nearbyLabelText(loc, usedFallback, radiusKm) {
  if (!loc) return 'recent (no gps available)';
  if (usedFallback) return `nothing within ${radiusKm}km — showing recent instead`;
  return 'nearby';
}

function backupReminderHtml(state) {
  if (!state.due) return '';
  let msg;
  if (state.neverBackedUp) {
    msg = `${state.entriesSince} new thing${state.entriesSince === 1 ? '' : 's'} saved, no backup yet`;
  } else if (state.entriesSince >= 10) {
    msg = `${state.entriesSince} new places/notes since your last backup`;
  } else {
    msg = `it's been ${state.daysSince} day${state.daysSince === 1 ? '' : 's'} since your last backup`;
  }
  return `
    <div class="backup-reminder" id="backup-reminder">
      <div><p class="label">backup reminder</p><p class="name">${escapeHtml(msg)}</p></div>
      <div style="display:flex; gap:6px; flex-shrink:0;">
        <a href="#/backup" class="badge accent" style="text-decoration:none;">backup now</a>
        <button type="button" id="backup-reminder-snooze" class="badge" style="border:none; cursor:pointer;">later</button>
      </div>
    </div>
  `;
}

export async function viewHome() {
  const [trips, entries, countries] = await Promise.all([getAll('trips'), getAll('entries'), getAll('countries')]);
  const activeTrip = trips.find((t) => t.is_active);
  const countryById = Object.fromEntries(countries.map((c) => [c.id, c]));
  const loc = await getLocation();
  const reminder = getReminderState();

  const { html: nearbyHtml, usedFallback: initialFallback } = nearbyListHtml(entries, countryById, loc, DEFAULT_RADIUS_KM);

  const body = `
    <div style="position:relative;">
      <div class="search-box">
        ${icon('search')}
        <input type="text" id="home-search-input" placeholder="search text or #tag" autocomplete="off">
      </div>
      <div id="home-search-results" class="tag-suggestions"></div>
    </div>

    ${activeTrip ? `
    <a href="#/trips/${activeTrip.id}" class="trip-active" style="text-decoration:none;">
      <div><p class="label">active trip</p><p class="name">${escapeHtml(activeTrip.name)}</p></div>
    </a>` : ''}

    ${backupReminderHtml(reminder)}

    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
      <p class="section-label" id="nearby-label" style="margin:0;">${nearbyLabelText(loc, initialFallback, DEFAULT_RADIUS_KM)}</p>
      ${loc ? `<div style="display:flex; gap:4px;">
        ${RADIUS_OPTIONS_KM.map((km) => `<button type="button" class="radius-btn badge ${km === DEFAULT_RADIUS_KM ? 'accent' : ''}" data-km="${km}" style="border:none; cursor:pointer;">${km}km</button>`).join('')}
      </div>` : ''}
    </div>

    <div id="nearby-list">${nearbyHtml}</div>

    ${!entries.length && trips.length === 0 ? `<button id="seed-btn" class="btn-icon-text" style="background:var(--surface-muted); color:var(--text-dark); border:1px solid var(--border);">load sample data to try the app</button>` : ''}
  `;

  return {
    title: 'Travel Diary',
    body,
    actions: `<a href="./Trip_Diary_quick-guide.pdf" target="_blank" class="icon-btn" title="guide" aria-label="guide">${icon('help')}</a>`,
    mount(container) {
      const snoozeBtn = container.querySelector('#backup-reminder-snooze');
      if (snoozeBtn) {
        snoozeBtn.addEventListener('click', () => {
          snoozeReminder();
          container.querySelector('#backup-reminder')?.remove();
        });
      }

      const seedBtn = container.querySelector('#seed-btn');
      if (seedBtn) {
        seedBtn.addEventListener('click', async () => {
          seedBtn.textContent = 'loading...';
          await seedDemoData();
          location.reload();
        });
      }

      const nearbyList = container.querySelector('#nearby-list');
      const nearbyLabel = container.querySelector('#nearby-label');
      container.querySelectorAll('.radius-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const km = Number(btn.dataset.km);
          container.querySelectorAll('.radius-btn').forEach((b) => b.classList.toggle('accent', b === btn));
          const { html, usedFallback } = nearbyListHtml(entries, countryById, loc, km);
          nearbyList.innerHTML = html;
          nearbyLabel.textContent = nearbyLabelText(loc, usedFallback, km);
        });
      });

      const input = container.querySelector('#home-search-input');
      const box = container.querySelector('#home-search-results');
      let timer;
      function hide() { box.style.display = 'none'; box.innerHTML = ''; }
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 2) { hide(); return; }
        timer = setTimeout(async () => {
          const items = (await searchEntries(q)).slice(0, 10);
          if (!items.length) { hide(); return; }
          box.innerHTML = items.map((e) => {
            const place = e.city ? `${escapeHtml(e.city)}, ${escapeHtml(e.country_name)}` : escapeHtml(e.country_name);
            return `<a href="#/entry/${e.id}" class="tag-suggestion" style="display:block; text-decoration:none; color:inherit;">
              <strong>${escapeHtml(e.title)}</strong> ${matchBadge(e.match_type)}
              <br><span style="font-size:11px; color:var(--text-muted);">${place}</span>${matchDetail(e)}</a>`;
          }).join('');
          box.style.display = 'block';
        }, 200);
      });
      document.addEventListener('click', (e) => {
        if (e.target !== input && !box.contains(e.target)) hide();
      });
    },
  };
}

// ---------- Global search ----------

export async function viewSearch(params, query) {
  const initialQ = (query.q || '').trim();
  const body = `
    <div class="search-box">
      ${icon('search')}
      <input type="text" id="search-input" value="${escapeHtml(initialQ)}" placeholder="search text or #tag" autocomplete="off">
    </div>
    <div id="search-results"></div>
  `;
  return {
    title: 'Search',
    body,
    mount(container) {
      const input = container.querySelector('#search-input');
      const results = container.querySelector('#search-results');
      async function run(q) {
        if (!q) { results.innerHTML = '<p class="empty-state">type to search titles, tags and notes.</p>'; return; }
        const items = await searchEntries(q);
        if (!items.length) {
          results.innerHTML = `<p class="section-label">0 results for "${escapeHtml(q)}"</p><p class="empty-state">no results.</p>`;
          return;
        }
        results.innerHTML = `<p class="section-label">${items.length} results for "${escapeHtml(q)}"</p>` +
          items.map((e) => `<a href="#/entry/${e.id}" class="card"><p class="title">${escapeHtml(e.title)} ${matchBadge(e.match_type)}</p><p class="meta">${escapeHtml(e.country_name)} &middot; ${escapeHtml(e.created_at)}</p>${matchDetail(e)}</a>`).join('');
      }
      let timer;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => run(input.value.trim()), 250);
      });
      run(initialQ);
      input.focus();
    },
  };
}

// ---------- Map tab ----------

export async function viewMap(params, query) {
  const tripId = query.trip ? Number(query.trip) : null;
  const countryId = query.country ? Number(query.country) : null;
  const isScoped = tripId != null || countryId != null;

  const [allEntries, trips, countries] = await Promise.all([getAll('entries'), getAll('trips'), getAll('countries')]);
  const countryById = Object.fromEntries(countries.map((c) => [c.id, c]));

  let pool = allEntries.filter((e) => e.lat != null && e.lon != null);
  let scopeLabel = null;
  if (tripId != null) {
    pool = pool.filter((e) => e.trip_id === tripId);
    scopeLabel = trips.find((t) => t.id === tripId)?.name || 'trip';
  } else if (countryId != null) {
    pool = pool.filter((e) => e.country_id === countryId);
    scopeLabel = countryById[countryId]?.name || 'country';
  }

  const body = `
    ${isScoped
      ? `<p class="section-label">${escapeHtml(scopeLabel)} &middot; ${pool.length} place${pool.length === 1 ? '' : 's'} on the map</p>`
      : `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <p class="section-label" id="map-mode-label" style="margin:0;">nearby</p>
          <div style="display:flex; gap:4px;">
            ${RADIUS_OPTIONS_KM.map((km) => `<button type="button" class="radius-btn badge" data-km="${km}">${km}km</button>`).join('')}
            <button type="button" class="radius-btn badge" data-km="all">all</button>
          </div>
        </div>`}
    <div class="leaflet-map-wrap"><div id="map-tab-map" class="leaflet-map map-tab-map"></div><button type="button" class="map-fullscreen-btn" data-fullscreen-btn title="view fullscreen" aria-label="view fullscreen">${icon('expand')}</button></div>
    <p id="map-empty-hint" class="empty-state" style="display:none;">no places with gps ${isScoped ? `in ${escapeHtml(scopeLabel)}` : 'nearby \u2014 try a bigger radius or "all"'}.</p>
  `;

  return {
    title: isScoped ? scopeLabel : 'Map',
    body,
    async mount(container) {
      const mapEl = container.querySelector('#map-tab-map');
      const map = L.map(mapEl, { attributionControl: true }).setView([20, 0], 2);
      createOfflineTileLayer().addTo(map);

      const wrapEl = container.querySelector('.leaflet-map-wrap');
      const fsBtn = container.querySelector('.leaflet-map-wrap [data-fullscreen-btn]');
      if (fsBtn && wrapEl) setupMapFullscreen(map, wrapEl, fsBtn);

      const markersLayer = L.layerGroup().addTo(map);
      const emptyHint = container.querySelector('#map-empty-hint');

      function renderMarkers(items) {
        markersLayer.clearLayers();
        if (!items.length) {
          emptyHint.style.display = 'block';
          return;
        }
        emptyHint.style.display = 'none';
        const latlngs = [];
        for (const e of items) {
          const marker = L.marker([e.lat, e.lon], { icon: pinIcon }).addTo(markersLayer);
          marker.bindPopup(`<strong>${escapeHtml(e.title)}</strong><br><a href="#/entry/${e.id}">open</a>`);
          latlngs.push([e.lat, e.lon]);
        }
        if (latlngs.length === 1) {
          map.setView(latlngs[0], 15);
        } else {
          map.fitBounds(latlngs, { padding: [30, 30] });
        }
      }

      if (isScoped) {
        renderMarkers(pool);
        return;
      }

      const modeLabel = container.querySelector('#map-mode-label');
      const loc = await getLocation();

      function applyRadius(km) {
        if (!loc) { renderMarkers(pool); return; }
        const within = pool.filter((e) => haversineMeters(loc.lat, loc.lon, e.lat, e.lon) <= km * 1000);
        renderMarkers(within);
      }

      const radiusBtns = container.querySelectorAll('.radius-btn');
      function selectBtn(km) {
        radiusBtns.forEach((b) => b.classList.toggle('accent', b.dataset.km === String(km)));
      }

      if (loc) {
        modeLabel.textContent = 'nearby';
        selectBtn(DEFAULT_RADIUS_KM);
        applyRadius(DEFAULT_RADIUS_KM);
      } else {
        modeLabel.textContent = 'all places (no gps available)';
        selectBtn('all');
        renderMarkers(pool);
      }

      radiusBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          selectBtn(btn.dataset.km);
          if (btn.dataset.km === 'all') {
            modeLabel.textContent = 'all places';
            renderMarkers(pool);
          } else if (loc) {
            modeLabel.textContent = 'nearby';
            applyRadius(Number(btn.dataset.km));
          } else {
            modeLabel.textContent = 'all places (no gps available)';
            renderMarkers(pool);
          }
        });
      });
    },
  };
}

// ---------- Trips ----------

export async function viewTripsList() {
  const [trips, entries, countries] = await Promise.all([getAll('trips'), getAll('entries'), getAll('countries')]);
  const countryById = Object.fromEntries(countries.map((c) => [c.id, c]));
  trips.sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));

  const rows = trips.map((t) => {
    const tripEntries = entries.filter((e) => e.trip_id === t.id);
    const countrySet = [...new Set(tripEntries.map((e) => countryById[e.country_id]?.name).filter(Boolean))];
    return `<a href="#/trips/${t.id}" class="card">
      ${t.is_active ? '<span class="badge accent">ongoing</span>' : ''}
      <p class="title">${escapeHtml(t.name)}</p>
      <p class="meta">${escapeHtml(t.start_date || '')}${t.end_date ? ' &ndash; ' + escapeHtml(t.end_date) : ''}</p>
      <div>${countrySet.map((c) => `<span class="badge country">${escapeHtml(c)}</span>`).join('')}<span class="badge">${tripEntries.length} entries</span></div>
    </a>`;
  }).join('');

  return {
    title: 'Trips',
    actions: `<a href="#/trips/new" class="icon-btn" title="new trip" aria-label="new trip">${icon('plus')}</a>`,
    body: rows || '<p class="empty-state">no trips yet.</p>',
  };
}

export async function viewTripForm(params) {
  const isEdit = !!params.id;
  const trip = isEdit ? await getById('trips', Number(params.id)) : null;

  const body = `
    <form id="trip-form">
      <label>trip name</label>
      <input type="text" name="name" required placeholder="e.g. Oman 2027" value="${escapeHtml(trip?.name || '')}">

      <label>dates</label>
      <div style="display:flex; gap:8px;">
        <input type="date" name="start_date" style="flex:1; min-width:0;" value="${trip?.start_date || ''}">
        <input type="date" name="end_date" style="flex:1; min-width:0;" value="${trip?.end_date || ''}">
      </div>
      ${hint('end date is optional')}

      <label style="display:flex; align-items:center; gap:8px; margin-top:16px;">
        <input type="checkbox" name="is_active" style="width:auto;" ${trip?.is_active ? 'checked' : ''}> set as active trip
      </label>
      ${hint("the active trip auto-fills new entries while you're traveling")}

      <button type="submit">${isEdit ? 'save changes' : 'create trip'}</button>
      ${isEdit ? `<button type="button" id="delete-trip-btn" class="btn-danger" style="background:#fff; border:1px solid var(--danger); color:var(--danger);">delete trip</button>` : ''}
    </form>
  `;
  return {
    title: isEdit ? 'Edit Trip' : 'New Trip',
    body,
    mount(container) {
      container.querySelector('#trip-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const makeActive = fd.get('is_active') === 'on';
        if (makeActive) {
          for (const t of await getAll('trips')) {
            if (t.is_active && (!isEdit || t.id !== trip.id)) { t.is_active = 0; await put('trips', t); }
          }
        }
        const data = {
          name: fd.get('name').trim(),
          start_date: fd.get('start_date') || null,
          end_date: fd.get('end_date') || null,
          is_active: makeActive ? 1 : 0,
        };
        let id;
        if (isEdit) {
          id = trip.id;
          await put('trips', { ...trip, ...data });
        } else {
          id = await add('trips', data);
        }
        navigate('/trips/' + id);
      });

      const delBtn = container.querySelector('#delete-trip-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const entries = await getAllByIndex('entries', 'trip_id', trip.id);
          const msg = entries.length
            ? `Delete "${trip.name}" and all ${entries.length} of its entries (with their notes)? This cannot be undone.`
            : `Delete "${trip.name}"? This cannot be undone.`;
          if (!confirm(msg)) return;
          for (const e of entries) await deleteEntryCascade(e.id);
          await remove('trips', trip.id);
          navigate('/trips');
        });
      }
    },
  };
}

export async function viewTripDetail(params, query) {
  const tripId = Number(params.id);
  const sort = query.sort || 'date';
  const prefillQuery = query.q || '';
  const trip = await getById('trips', tripId);
  const countries = await getAll('countries');
  const countryById = Object.fromEntries(countries.map((c) => [c.id, c]));

  let entries = await getAllByIndex('entries', 'trip_id', tripId);
  if (sort === 'location') {
    entries.sort((a, b) => {
      const ca = countryById[a.country_id]?.name || '';
      const cb = countryById[b.country_id]?.name || '';
      if (ca !== cb) return ca.localeCompare(cb);
      const cityA = a.city || ''; const cityB = b.city || '';
      if (cityA !== cityB) return cityA.localeCompare(cityB);
      return a.created_at.localeCompare(b.created_at);
    });
  } else {
    entries.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  let lastGroup = null;
  const listHtml = entries.map((e) => {
    const c = countryById[e.country_id];
    let groupHtml = '';
    if (sort === 'location') {
      const key = (c?.name || '') + '|' + (e.city || '');
      if (key !== lastGroup) {
        groupHtml = `<p class="section-label" style="margin-top:14px;">${escapeHtml(c?.name || '')}${e.city ? ' &middot; ' + escapeHtml(e.city) : ''}</p>`;
        lastGroup = key;
      }
    }
    const meta = sort !== 'location'
      ? `${escapeHtml(e.created_at)} &middot; ${e.city ? escapeHtml(e.city) + ', ' + escapeHtml(c?.name || '') : escapeHtml(c?.name || '')}`
      : escapeHtml(e.created_at);
    return groupHtml + `<a href="#/entry/${e.id}" class="card"><p class="title">${escapeHtml(e.title)}</p><p class="meta">${meta}</p></a>`;
  }).join('') || '<p class="empty-state">no entries in this trip.</p>';

  const body = `
    <div class="search-box">
      ${icon('search')}
      <input type="text" id="trip-search-input" placeholder="search this trip: text or #tag" value="${escapeHtml(prefillQuery)}" autocomplete="off">
    </div>
    <div id="trip-search-results" style="display:none;"></div>
    <div id="trip-original">
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <a href="#/trips/${tripId}${buildQuery({ sort: 'date' })}" class="badge ${sort !== 'location' ? 'accent' : ''}" style="text-decoration:none;">by date</a>
        <a href="#/trips/${tripId}${buildQuery({ sort: 'location' })}" class="badge ${sort === 'location' ? 'accent' : ''}" style="text-decoration:none;">by country/city</a>
      </div>
      <p class="section-label">${entries.length} entries</p>
      ${listHtml}
      ${entries.some((e) => e.lat && e.lon) ? `
      <a href="#/map${buildQuery({ trip: tripId })}" class="btn btn-icon-text" style="text-decoration:none; display:flex; background:var(--surface-muted); color:var(--text-dark); border:1px solid var(--border);">${icon('map')} view on map</a>
      ${downloadMapControlsHtml('trip')}` : ''}
    </div>
  `;

  return {
    title: trip ? trip.name : 'Trip',
    actions: `<a href="#/trips/${tripId}/edit" class="icon-btn" title="edit trip" aria-label="edit trip">${icon('edit')}</a>
      <a href="#/trips/${tripId}/tags" class="icon-btn" title="tags for this trip" aria-label="tags for this trip">${icon('tag')}</a>`,
    body,
    mount(container) {
      const downloadBtn = container.querySelector('#download-map-btn');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
          downloadBtn.disabled = true;
          const points = entries.filter((e) => e.lat && e.lon).map((e) => ({ lat: e.lat, lon: e.lon }));
          const radiusKm = Number(container.querySelector('#download-radius-select')?.value || 1);
          const tiles = planDownloadAroundPoints(points, radiusKm);
          downloadBtn.textContent = `downloading 0 of ${tiles.length} tiles...`;
          await downloadTiles(tiles, (done, total) => {
            downloadBtn.textContent = `downloading ${done} of ${total} tiles...`;
          });
          downloadBtn.textContent = `${tiles.length} tiles ready offline`;
          downloadBtn.disabled = false;
        });
      }

      const input = container.querySelector('#trip-search-input');
      const resultsBox = container.querySelector('#trip-search-results');
      const original = container.querySelector('#trip-original');
      let timer;
      async function run(q) {
        const items = await searchEntries(q, tripId);
        if (!items.length) { resultsBox.innerHTML = '<p class="empty-state">no results in this trip.</p>'; return; }
        resultsBox.innerHTML = items.map((e) => {
          const place = e.city ? `${escapeHtml(e.city)}, ${escapeHtml(e.country_name)}` : escapeHtml(e.country_name);
          return `<a href="#/entry/${e.id}" class="card"><p class="title">${escapeHtml(e.title)} ${matchBadge(e.match_type)}</p><p class="meta">${escapeHtml(e.created_at)} &middot; ${place}</p>${matchDetail(e)}</a>`;
        }).join('');
      }
      function onInput() {
        const q = input.value.trim();
        clearTimeout(timer);
        if (q.length < 2) { resultsBox.style.display = 'none'; original.style.display = 'block'; return; }
        original.style.display = 'none'; resultsBox.style.display = 'block';
        timer = setTimeout(() => run(q), 200);
      }
      input.addEventListener('input', onInput);
      if (input.value.trim().length >= 2) onInput();
    },
  };
}

export async function viewTripTags(params) {
  const tripId = Number(params.id);
  const trip = await getById('trips', tripId);
  const entries = await getAllByIndex('entries', 'trip_id', tripId);
  const entryIds = new Set(entries.map((e) => e.id));
  const [entryTags, tags] = await Promise.all([getAll('entry_tags'), getAll('tags')]);
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));
  const countByTag = {};
  for (const link of entryTags) {
    if (entryIds.has(link.entry_id)) countByTag[link.tag_id] = (countByTag[link.tag_id] || 0) + 1;
  }
  const rows = Object.entries(countByTag)
    .map(([tagId, count]) => ({ name: tagById[tagId]?.name, count }))
    .filter((r) => r.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const body = rows.length
    ? rows.map((r) => `<a href="#/trips/${tripId}${buildQuery({ q: r.name })}" class="card"><p class="title">#${escapeHtml(r.name)}</p><p class="meta">${r.count} entries</p></a>`).join('')
    : '<p class="empty-state">no tags in this trip yet.</p>';

  return { title: `Tags &middot; ${trip ? trip.name : ''}`, body };
}

// ---------- Countries ----------

export async function viewCountriesList() {
  const [countries, entries] = await Promise.all([getAll('countries'), getAll('entries')]);
  const countByCountry = {};
  for (const e of entries) countByCountry[e.country_id] = (countByCountry[e.country_id] || 0) + 1;
  const sorted = [...countries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const body = `
    <p class="section-label">countries</p>
    ${sorted.length ? sorted.map((c) => `<a href="#/countries/${c.id}" class="card"><p class="title">${escapeHtml(c.name)}</p><p class="meta">${countByCountry[c.id] || 0} entries</p></a>`).join('') : '<p class="empty-state">no countries yet.</p>'}
    <p class="section-label">tags</p>
    <a href="#/tags" class="card"><p class="title">all tags</p></a>
    <p class="section-label">data</p>
    <a href="#/backup" class="card"><p class="title">backup &amp; restore</p></a>
    <a href="#/import" class="card"><p class="title">import shared entry</p></a>
  `;
  return { title: 'Explore', body };
}

export async function viewCountryDetail(params, query) {
  const countryId = Number(params.id);
  const sort = query.sort || 'date';
  const country = await getById('countries', countryId);
  const entries = await getAllByIndex('entries', 'country_id', countryId);
  const trips = await getAll('trips');
  const tripById = Object.fromEntries(trips.map((t) => [t.id, t]));

  if (sort === 'city') {
    entries.sort((a, b) => {
      const cityA = a.city || ''; const cityB = b.city || '';
      if (cityA !== cityB) return cityA.localeCompare(cityB);
      return a.created_at.localeCompare(b.created_at);
    });
  } else {
    entries.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  let lastCity = null;
  const listHtml = entries.map((e) => {
    let groupHtml = '';
    if (sort === 'city') {
      const key = e.city || '';
      if (key !== lastCity) {
        groupHtml = `<p class="section-label" style="margin-top:14px;">${e.city ? escapeHtml(e.city) : 'no city'}</p>`;
        lastCity = key;
      }
    }
    const meta = sort === 'city'
      ? escapeHtml(e.created_at)
      : `${escapeHtml(e.created_at)} &middot; ${escapeHtml(tripById[e.trip_id]?.name || '')}`;
    return groupHtml + `<a href="#/entry/${e.id}" class="card"><p class="title">${escapeHtml(e.title)}</p><p class="meta">${meta}</p></a>`;
  }).join('') || '<p class="empty-state">no entries in this country.</p>';

  const body = `
    <div class="search-box">
      ${icon('search')}
      <input type="text" id="country-search-input" placeholder="search this country: text or #tag" autocomplete="off">
    </div>
    <div id="country-search-results" style="display:none;"></div>
    <div id="country-original">
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <a href="#/countries/${countryId}${buildQuery({ sort: 'date' })}" class="badge ${sort !== 'city' ? 'accent' : ''}" style="text-decoration:none;">by date</a>
        <a href="#/countries/${countryId}${buildQuery({ sort: 'city' })}" class="badge ${sort === 'city' ? 'accent' : ''}" style="text-decoration:none;">by city</a>
      </div>
      <p class="section-label">${entries.length} entries &middot; all trips</p>
      ${listHtml}
      ${entries.some((e) => e.lat && e.lon) ? `
      <a href="#/map${buildQuery({ country: countryId })}" class="btn btn-icon-text" style="text-decoration:none; display:flex; background:var(--surface-muted); color:var(--text-dark); border:1px solid var(--border);">${icon('map')} view on map</a>
      ${downloadMapControlsHtml('country')}` : ''}
    </div>
  `;

  return {
    title: country ? country.name : 'Country',
    body,
    mount(container) {
      const downloadBtn = container.querySelector('#download-map-btn');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
          downloadBtn.disabled = true;
          const points = entries.filter((e) => e.lat && e.lon).map((e) => ({ lat: e.lat, lon: e.lon }));
          const radiusKm = Number(container.querySelector('#download-radius-select')?.value || 1);
          const tiles = planDownloadAroundPoints(points, radiusKm);
          downloadBtn.textContent = `downloading 0 of ${tiles.length} tiles...`;
          await downloadTiles(tiles, (done, total) => {
            downloadBtn.textContent = `downloading ${done} of ${total} tiles...`;
          });
          downloadBtn.textContent = `${tiles.length} tiles ready offline`;
          downloadBtn.disabled = false;
        });
      }

      const input = container.querySelector('#country-search-input');
      const resultsBox = container.querySelector('#country-search-results');
      const original = container.querySelector('#country-original');
      let timer;
      async function run(q) {
        const items = await searchEntries(q, null, countryId);
        if (!items.length) { resultsBox.innerHTML = '<p class="empty-state">no results in this country.</p>'; return; }
        resultsBox.innerHTML = items.map((e) => {
          const place = e.city ? `${escapeHtml(e.city)}, ${escapeHtml(e.country_name)}` : escapeHtml(e.country_name);
          return `<a href="#/entry/${e.id}" class="card"><p class="title">${escapeHtml(e.title)} ${matchBadge(e.match_type)}</p><p class="meta">${escapeHtml(e.created_at)} &middot; ${place}</p>${matchDetail(e)}</a>`;
        }).join('');
      }
      input.addEventListener('input', () => {
        const q = input.value.trim();
        clearTimeout(timer);
        if (q.length < 2) { resultsBox.style.display = 'none'; original.style.display = 'block'; return; }
        original.style.display = 'none'; resultsBox.style.display = 'block';
        timer = setTimeout(() => run(q), 200);
      });
    },
  };
}

// ---------- Global tags ----------

export async function viewTagsList() {
  const [tags, entryTags] = await Promise.all([getAll('tags'), getAll('entry_tags')]);
  const countByTag = {};
  for (const link of entryTags) countByTag[link.tag_id] = (countByTag[link.tag_id] || 0) + 1;
  const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const body = sorted.length
    ? sorted.map((t) => `<a href="#/search${buildQuery({ q: t.name })}" class="card"><p class="title">#${escapeHtml(t.name)}</p><p class="meta">${countByTag[t.id] || 0} entries</p></a>`).join('')
    : '<p class="empty-state">no tags yet.</p>';
  return { title: 'Tags', body };
}

// ---------- Entry ----------

export async function viewEntryDetail(params) {
  const entryId = Number(params.id);
  const entry = await getById('entries', entryId);
  if (!entry) return { title: 'Entry', body: '<p class="empty-state">entry not found.</p>' };

  const [country, trip, tagNames, annotations] = await Promise.all([
    getById('countries', entry.country_id),
    getById('trips', entry.trip_id),
    getEntryTagNames(entryId),
    getAllByIndex('annotations', 'entry_id', entryId),
  ]);
  annotations.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const annHtml = annotations.length ? annotations.map((a) => {
    let thumb = icon('link');
    if (a.photo_blob) thumb = `<img src="${URL.createObjectURL(a.photo_blob)}">`;
    return `<a href="#/annotation/${a.id}" class="annotation">
      <div class="thumb">${thumb}</div>
      <div><p class="text">${escapeHtml(a.text || a.url || '(empty)')}</p><p class="time">${escapeHtml(a.timestamp)}</p></div>
    </a>`;
  }).join('') : '<p class="empty-state">no notes yet.</p>';

  const cityBadge = entry.city ? `${escapeHtml(entry.city)}, ${escapeHtml(country?.name || '')}` : escapeHtml(country?.name || '');

  const body = `
    <div class="entry-header">
      <span class="badge country">${cityBadge}</span>
      <span class="badge">${escapeHtml(trip?.name || '')}</span>
      <h2>${escapeHtml(entry.title)}</h2>
      <p class="entry-meta">${escapeHtml(entry.created_at)}${entry.lat && entry.lon ? ` &middot; ${entry.lat.toFixed(4)}, ${entry.lon.toFixed(4)}` : ''}</p>
      ${tagNames.map((t) => `<span class="badge">#${escapeHtml(t)}</span>`).join('')}
    </div>
    <div style="display:flex; gap:8px; margin: 10px 0;">
      <button type="button" id="share-zip-btn" class="btn-icon-text" style="flex:1; background:var(--surface-muted); color:var(--text-dark); border:1px solid var(--border);">${icon('share')} share for travel diary</button>
      <button type="button" id="share-html-btn" class="btn-icon-text" style="flex:1; background:var(--surface-muted); color:var(--text-dark); border:1px solid var(--border);">${icon('external')} share as readable file</button>
    </div>
    ${entry.lat && entry.lon
      ? `<div class="leaflet-map-wrap"><div id="entry-map" class="leaflet-map"></div><button type="button" class="map-fullscreen-btn" data-fullscreen-btn title="view fullscreen" aria-label="view fullscreen">${icon('expand')}</button></div>
         <p class="meta" id="entry-address">looking up address...</p>`
      : `<div class="map-placeholder">no gps location for this entry</div>`}
    ${entry.lat && entry.lon ? `<a class="btn btn-icon-text" href="https://maps.google.com/?q=${entry.lat},${entry.lon}" target="_blank">${icon('external')} open in google maps</a>` : ''}
    <p class="section-label">notes (${annotations.length})</p>
    ${annHtml}
    <a class="btn btn-icon-text" href="#/entry/${entryId}/annotation/new">${icon('plus')} add note</a>
  `;

  return {
    title: entry.title,
    actions: `<a href="#/entry/${entryId}/edit" class="icon-btn" title="edit entry" aria-label="edit entry">${icon('edit')}</a>
      <button data-action="delete-entry" class="icon-btn danger" title="delete entry" aria-label="delete entry">${icon('trash')}</button>`,
    body,
    mount(container) {
      const delBtn = document.getElementById('topbar-actions').querySelector('[data-action="delete-entry"]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this entry and all its notes?')) return;
          await deleteEntryCascade(entryId);
          navigate('/');
        });
      }

      const shareZipBtn = container.querySelector('#share-zip-btn');
      if (shareZipBtn) {
        shareZipBtn.addEventListener('click', async () => {
          const original = shareZipBtn.innerHTML;
          shareZipBtn.disabled = true;
          shareZipBtn.textContent = 'preparing...';
          try {
            const { blob, filename } = await exportEntryZip(entryId);
            await shareOrDownload(blob, filename, { title: entry.title, text: `Travel Diary entry: ${entry.title}` });
          } catch (err) {
            alert('Could not prepare the file: ' + err.message);
          } finally {
            shareZipBtn.disabled = false;
            shareZipBtn.innerHTML = original;
          }
        });
      }

      const shareHtmlBtn = container.querySelector('#share-html-btn');
      if (shareHtmlBtn) {
        shareHtmlBtn.addEventListener('click', async () => {
          const original = shareHtmlBtn.innerHTML;
          shareHtmlBtn.disabled = true;
          shareHtmlBtn.textContent = 'preparing...';
          try {
            const { blob, filename } = await exportEntryHtml(entryId);
            await shareOrDownload(blob, filename, { title: entry.title, text: `Travel Diary entry: ${entry.title}` });
          } catch (err) {
            alert('Could not prepare the file: ' + err.message);
          } finally {
            shareHtmlBtn.disabled = false;
            shareHtmlBtn.innerHTML = original;
          }
        });
      }

      const addressEl = container.querySelector('#entry-address');
      if (addressEl && entry.lat && entry.lon) {
        reverseGeocodeAddress(entry.lat, entry.lon).then((address) => {
          addressEl.textContent = address || 'address unavailable';
        });
      }

      const mapEl = container.querySelector('#entry-map');
      if (mapEl && entry.lat && entry.lon) {
        // Leaflet needs the container in the DOM with a real height before
        // it measures itself, which is guaranteed here since mount() runs
        // after the body markup (with its CSS height) is inserted.
        const map = L.map(mapEl, { attributionControl: true }).setView([entry.lat, entry.lon], 15);
        createOfflineTileLayer().addTo(map);
        L.marker([entry.lat, entry.lon], { icon: pinIcon }).addTo(map);

        const wrapEl = container.querySelector('.leaflet-map-wrap');
        const fsBtn = container.querySelector('.leaflet-map-wrap [data-fullscreen-btn]');
        if (fsBtn && wrapEl) setupMapFullscreen(map, wrapEl, fsBtn);
      }
    },
  };
}

export async function viewEntryForm(params) {
  const isEdit = !!params.id;
  const entry = isEdit ? await getById('entries', Number(params.id)) : null;
  const trips = await getAll('trips');
  trips.sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
  const activeTrip = trips.find((t) => t.is_active);

  let countryName = '', cityValue = '', tagsValue = '', lat = '', lon = '';
  let defaultCountry = '', defaultCity = '';

  if (isEdit && entry) {
    const country = await getById('countries', entry.country_id);
    countryName = country ? country.name : '';
    cityValue = entry.city || '';
    tagsValue = (await getEntryTagNames(entry.id)).join(', ');
    lat = entry.lat ?? '';
    lon = entry.lon ?? '';
  } else {
    const allEntries = await getAll('entries');
    if (allEntries.length) {
      allEntries.sort((a, b) => b.id - a.id);
      const last = allEntries[0];
      const lastCountry = await getById('countries', last.country_id);
      defaultCountry = lastCountry ? lastCountry.name : '';
      defaultCity = last.city || '';
    }
  }

  const body = `
    <form id="entry-form">
      <label>title</label>
      <input type="text" name="title" required value="${escapeHtml(entry?.title || '')}">

      <label>trip</label>
      <select name="trip_id" required>
        ${trips.map((t) => `<option value="${t.id}" ${(entry && entry.trip_id === t.id) || (!entry && activeTrip && activeTrip.id === t.id) ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
      </select>

      <label>country</label>
      <input type="text" name="country" id="country-input" required value="${escapeHtml(isEdit ? countryName : defaultCountry)}" placeholder="e.g. Thailand">
      <p class="hint" id="country-hint">${!isEdit && defaultCountry ? '*prefilled from your last entry, editable if you moved' : ''}</p>

      <label>city</label>
      <input type="text" name="city" id="city-input" value="${escapeHtml(isEdit ? cityValue : defaultCity)}" placeholder="e.g. Bangkok">
      <p class="hint" id="city-hint">${!isEdit && defaultCity ? '*prefilled from your last entry, editable if you moved' : ''}</p>

      <label>tags (comma separated)</label>
      <div style="position:relative;">
        <input type="text" name="tags" id="tags-input" autocomplete="off" value="${escapeHtml(tagsValue)}" placeholder="restaurants, seafood">
        <div id="tag-suggestions" class="tag-suggestions"></div>
      </div>

      <label>location (gps)</label>
      <div style="display:flex; gap:8px;">
        <input type="number" step="any" name="lat" id="lat-input" placeholder="lat" value="${lat}">
        <input type="number" step="any" name="lon" id="lon-input" placeholder="lon" value="${lon}">
      </div>
      <p class="hint" id="gps-hint">${isEdit ? '*edit manually if gps isn\'t accurate' : '*detecting gps...'}</p>
      <div class="leaflet-map-wrap"><div id="entry-form-map" class="leaflet-map"></div><button type="button" class="map-fullscreen-btn" data-fullscreen-btn title="view fullscreen" aria-label="view fullscreen">${icon('expand')}</button></div>
      ${hint('drag the pin to fine-tune, or tap the map to place it — country/city update automatically')}

      ${!isEdit ? `
      <label>first note (optional)</label>
      <input type="file" name="first_photo" accept="image/*">
      <textarea name="first_text" placeholder="anything worth remembering about this place..."></textarea>
      <input type="text" inputmode="url" name="first_url" placeholder="www.example.com (optional)" style="margin-top:8px;">
      ${hint('you can add more notes any time from the entry page')}
      ` : ''}

      <button type="submit">save</button>
    </form>
  `;

  return {
    title: isEdit ? 'Edit Entry' : 'New Entry',
    body,
    mount(container) {
      const form = container.querySelector('#entry-form');
      const tagsInput = container.querySelector('#tags-input');
      const suggBox = container.querySelector('#tag-suggestions');
      const latInput = container.querySelector('#lat-input');
      const lonInput = container.querySelector('#lon-input');
      const gpsHint = container.querySelector('#gps-hint');
      const countryInput = form.querySelector('#country-input');
      const cityInput = form.querySelector('#city-input');
      const countryHint = form.querySelector('#country-hint');
      const cityHint = form.querySelector('#city-hint');

      // whenever the pin is placed or moved (drag, click, or initial gps
      // fix), look up country/city for that spot and fill the fields —
      // works the same in both "new entry" and "edit entry" flows, so
      // relocating an existing entry keeps country/city in sync with gps
      async function updateAddressFromPin(lat, lon) {
        countryHint.textContent = '*looking up location...';
        cityHint.textContent = '';
        const geo = await reverseGeocode(lat, lon);
        if (geo) {
          if (geo.country) countryInput.value = geo.country;
          if (geo.city) cityInput.value = geo.city;
          countryHint.textContent = '*updated from pin location, editable';
          cityHint.textContent = geo.city ? '*updated from pin location, editable' : '';
        } else {
          countryHint.textContent = '*could not detect location here, edit manually';
        }
      }

      // ---- map with draggable pin, two-way synced with lat/lon inputs ----
      const DEFAULT_CENTER = [20, 0];
      const DEFAULT_ZOOM = 2;
      const initialLat = latInput.value ? Number(latInput.value) : null;
      const initialLon = lonInput.value ? Number(lonInput.value) : null;

      const formMapEl = container.querySelector('#entry-form-map');
      const formMap = L.map(formMapEl).setView(
        initialLat != null && initialLon != null ? [initialLat, initialLon] : DEFAULT_CENTER,
        initialLat != null && initialLon != null ? 15 : DEFAULT_ZOOM
      );
      createOfflineTileLayer().addTo(formMap);

      const formWrapEl = container.querySelector('.leaflet-map-wrap');
      const formFsBtn = container.querySelector('.leaflet-map-wrap [data-fullscreen-btn]');
      if (formFsBtn && formWrapEl) setupMapFullscreen(formMap, formWrapEl, formFsBtn);

      let formMarker = null;
      function placeMarker(lat, lon, { pan } = {}) {
        if (!formMarker) {
          formMarker = L.marker([lat, lon], { draggable: true, icon: pinIcon }).addTo(formMap);
          formMarker.on('dragend', () => {
            const pos = formMarker.getLatLng();
            latInput.value = pos.lat.toFixed(6);
            lonInput.value = pos.lng.toFixed(6);
            gpsHint.textContent = '*pin dragged manually';
            updateAddressFromPin(pos.lat, pos.lng);
          });
        } else {
          formMarker.setLatLng([lat, lon]);
        }
        if (pan) formMap.setView([lat, lon], Math.max(formMap.getZoom(), 15));
      }
      if (initialLat != null && initialLon != null) placeMarker(initialLat, initialLon);

      function onLatLonInputsChanged() {
        const lat = Number(latInput.value);
        const lon = Number(lonInput.value);
        if (latInput.value && lonInput.value && !Number.isNaN(lat) && !Number.isNaN(lon)) {
          placeMarker(lat, lon, { pan: true });
        }
      }
      latInput.addEventListener('input', onLatLonInputsChanged);
      lonInput.addEventListener('input', onLatLonInputsChanged);

      formMap.on('click', (e) => {
        latInput.value = e.latlng.lat.toFixed(6);
        lonInput.value = e.latlng.lng.toFixed(6);
        placeMarker(e.latlng.lat, e.latlng.lng, { pan: false });
        gpsHint.textContent = '*pin placed manually';
        updateAddressFromPin(e.latlng.lat, e.latlng.lng);
      });

      if (!isEdit) {
        getLocation().then(async (loc) => {
          if (loc && !latInput.value && !lonInput.value) {
            latInput.value = loc.lat.toFixed(6);
            lonInput.value = loc.lon.toFixed(6);
            gpsHint.textContent = '*prefilled from current gps, editable';
            onLatLonInputsChanged();
            await updateAddressFromPin(loc.lat, loc.lon);
          } else if (!loc) {
            gpsHint.textContent = '*gps not available, enter location manually if you like';
          }
        });
      }

      let tagTimer;
      function currentFragment() {
        const parts = tagsInput.value.split(',');
        return parts[parts.length - 1].trim();
      }
      function hideSugg() { suggBox.style.display = 'none'; suggBox.innerHTML = ''; }
      tagsInput.addEventListener('input', () => {
        clearTimeout(tagTimer);
        const frag = currentFragment();
        if (frag.length < 3) { hideSugg(); return; }
        tagTimer = setTimeout(async () => {
          const allTags = await getAll('tags');
          const matches = allTags.filter((t) => t.name.toLowerCase().includes(frag.toLowerCase())).slice(0, 8);
          if (!matches.length) { hideSugg(); return; }
          suggBox.innerHTML = matches.map((t) => `<div class="tag-suggestion" data-tag="${escapeHtml(t.name)}">#${escapeHtml(t.name)}</div>`).join('');
          suggBox.style.display = 'block';
        }, 150);
      });
      suggBox.addEventListener('click', (e) => {
        const item = e.target.closest('.tag-suggestion');
        if (!item) return;
        const tag = item.getAttribute('data-tag');
        let parts = tagsInput.value.split(',');
        parts[parts.length - 1] = ' ' + tag;
        tagsInput.value = parts.join(',').split(',').map((p) => p.trim()).filter(Boolean).join(', ') + ', ';
        hideSugg();
        tagsInput.focus();
      });
      document.addEventListener('click', (e) => {
        if (e.target !== tagsInput && !suggBox.contains(e.target)) hideSugg();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const countryId = await findOrCreateCountry(fd.get('country').trim());
        const tagNames = fd.get('tags').split(',').map((t) => t.trim()).filter(Boolean);
        const data = {
          trip_id: Number(fd.get('trip_id')),
          country_id: countryId,
          title: fd.get('title').trim(),
          city: fd.get('city').trim() || null,
          lat: fd.get('lat') ? Number(fd.get('lat')) : null,
          lon: fd.get('lon') ? Number(fd.get('lon')) : null,
        };
        let id;
        let createdAt;
        if (isEdit) {
          id = entry.id;
          await put('entries', { ...entry, ...data });
        } else {
          createdAt = new Date().toISOString().slice(0, 16);
          data.created_at = createdAt;
          id = await add('entries', data);
          noteContentAdded();
        }
        await setEntryTags(id, tagNames);

        if (!isEdit) {
          const firstText = (fd.get('first_text') || '').trim();
          const firstUrl = normalizeUrl(fd.get('first_url'));
          const firstPhoto = fd.get('first_photo');
          const hasPhoto = firstPhoto && firstPhoto.size > 0;
          if (firstText || firstUrl || hasPhoto) {
            await add('annotations', {
              entry_id: id,
              text: firstText || null,
              url: firstUrl || null,
              photo_blob: hasPhoto ? firstPhoto : null,
              timestamp: createdAt,
            });
            noteContentAdded();
          }
        }

        navigate('/entry/' + id);
      });
    },
  };
}

// ---------- Annotation ----------

export async function viewAnnotationForm(params) {
  const isEdit = !!params.annotationId;
  let entryId, annotation = null;
  if (isEdit) {
    annotation = await getById('annotations', Number(params.annotationId));
    entryId = annotation.entry_id;
  } else {
    entryId = Number(params.entryId);
  }
  const entry = await getById('entries', entryId);
  const entryTitle = entry ? entry.title : '';

  const existingPhotoHtml = (isEdit && annotation.photo_blob)
    ? `<div class="map-placeholder" style="height:140px; overflow:hidden; padding:0; margin-bottom:6px;">
         <img src="${URL.createObjectURL(annotation.photo_blob)}" style="width:100%;height:100%;object-fit:cover;">
       </div>${hint('upload a new photo to replace it')}`
    : '';

  const body = `
    <p class="section-label">note for <strong>${escapeHtml(entryTitle)}</strong></p>
    <form id="annotation-form">
      ${existingPhotoHtml}
      <label>photo ${isEdit ? '(optional, replaces the current one)' : ''}</label>
      <input type="file" name="photo" id="photo-input" accept="image/*">

      <label>text</label>
      <textarea name="text" placeholder="this is the alley entrance...">${escapeHtml(annotation?.text || '')}</textarea>

      <label>url (optional)</label>
      <input type="text" inputmode="url" name="url" placeholder="www.example.com" value="${escapeHtml(annotation?.url || '')}">

      <button type="submit">${isEdit ? 'save changes' : 'save note'}</button>
    </form>
  `;

  return {
    title: isEdit ? 'Edit Note' : 'New Note',
    body,
    mount(container) {
      const form = container.querySelector('#annotation-form');
      const photoInput = container.querySelector('#photo-input');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        let photoBlob = isEdit ? annotation.photo_blob : null;
        const file = photoInput.files[0];
        if (file) photoBlob = file;

        const data = {
          entry_id: entryId,
          text: fd.get('text').trim() || null,
          url: normalizeUrl(fd.get('url')) || null,
          photo_blob: photoBlob || null,
          timestamp: isEdit ? annotation.timestamp : new Date().toISOString().slice(0, 16),
        };
        if (isEdit) await put('annotations', { ...annotation, ...data });
        else {
          await add('annotations', data);
          noteContentAdded();
        }
        navigate('/entry/' + entryId);
      });
    },
  };
}

export async function viewAnnotationDetail(params) {
  const id = Number(params.id);
  const annotation = await getById('annotations', id);
  if (!annotation) return { title: 'Note', body: '<p class="empty-state">note not found.</p>' };
  const entry = await getById('entries', annotation.entry_id);

  const photoUrl = annotation.photo_blob ? URL.createObjectURL(annotation.photo_blob) : null;
  const photoHtml = photoUrl
    ? `<div class="map-placeholder" id="annotation-photo" style="height:220px; overflow:hidden; padding:0; cursor:pointer;"><img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;"></div>`
    : '';

  const body = `
    <p class="section-label">note for <strong>${escapeHtml(entry?.title || '')}</strong></p>
    ${photoHtml}
    <p style="font-size:15px; line-height:1.6;">${escapeHtml(annotation.text || '')}</p>
    <p class="meta">${escapeHtml(annotation.timestamp)}</p>
    ${annotation.url ? `<p class="meta"><a href="${escapeHtml(annotation.url)}" target="_blank">${escapeHtml(annotation.url)}</a></p>` : ''}
  `;

  return {
    title: 'Note',
    actions: `<a href="#/annotation/${id}/edit" class="icon-btn" title="edit note" aria-label="edit note">${icon('edit')}</a>
      <button data-action="delete-annotation" class="icon-btn danger" title="delete note" aria-label="delete note">${icon('trash')}</button>`,
    body,
    mount() {
      const delBtn = document.getElementById('topbar-actions').querySelector('[data-action="delete-annotation"]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this note?')) return;
          await remove('annotations', id);
          navigate('/entry/' + annotation.entry_id);
        });
      }

      const photoEl = document.getElementById('annotation-photo');
      if (photoEl) photoEl.addEventListener('click', () => openLightbox(photoUrl));
    },
  };
}

// ---------- Backup ----------

export async function viewBackup() {
  const counts = await Promise.all(
    ['trips', 'entries', 'annotations', 'tags'].map(async (t) => [t, (await getAll(t)).length])
  );
  const summary = Object.fromEntries(counts);

  const body = `
    <p class="section-label">what's stored right now</p>
    <div class="card">
      <p class="meta">${summary.trips} trips &middot; ${summary.entries} entries &middot; ${summary.annotations} notes &middot; ${summary.tags} tags</p>
    </div>

    <p class="section-label" style="margin-top:20px;">export</p>
    <button id="export-btn" class="btn-icon-text">${icon('external')} download backup (.zip)</button>
    ${hint('saves everything — including photos — into one file. keep it somewhere safe (Drive, PC, email to yourself).')}

    <p class="section-label" style="margin-top:20px;">restore</p>
    <input type="file" id="import-input" accept=".zip">
    ${hint('this replaces ALL current data with the content of the backup file — cannot be undone.')}
    <button id="import-btn" class="btn-icon-text">restore from backup</button>
  `;

  return {
    title: 'Backup & Restore',
    body,
    mount(container) {
      const exportBtn = container.querySelector('#export-btn');
      exportBtn.addEventListener('click', async () => {
        exportBtn.textContent = 'preparing...';
        try {
          await exportBackup();
          noteBackupCompleted();
        } finally {
          exportBtn.innerHTML = `${icon('external')} download backup (.zip)`;
        }
      });

      const importInput = container.querySelector('#import-input');
      const importBtn = container.querySelector('#import-btn');
      importBtn.addEventListener('click', async () => {
        const file = importInput.files[0];
        if (!file) { alert('choose a .zip backup file first'); return; }
        if (!confirm('This will replace ALL current data with the backup file. Continue?')) return;
        importBtn.textContent = 'restoring...';
        try {
          await importBackup(file);
          noteBackupCompleted();
          alert('Backup restored successfully.');
          navigate('/');
        } catch (err) {
          alert('Could not restore this backup: ' + err.message);
        } finally {
          importBtn.textContent = 'restore from backup';
        }
      });
    },
  };
}

// ---------- Import shared entry ----------

export async function viewImportEntry() {
  const trips = await getAll('trips');
  trips.sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));

  const body = `
    <p class="section-label">import a shared entry</p>
    <input type="file" id="import-file-input" accept=".zip">
    ${hint('choose a Travel Diary entry file (.zip) that someone shared with you.')}

    <div id="import-preview" style="display:none; margin-top:14px;">
      <div class="card" id="import-summary"></div>

      <label>save into trip</label>
      <select id="import-trip-select">
        ${trips.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
        <option value="__new__">+ new trip...</option>
      </select>
      <input type="text" id="import-new-trip-name" placeholder="new trip name" style="display:none; margin-top:8px;">

      <button type="button" id="import-confirm-btn">import entry</button>
    </div>
  `;

  return {
    title: 'Import Entry',
    body,
    mount(container) {
      const fileInput = container.querySelector('#import-file-input');
      const preview = container.querySelector('#import-preview');
      const summary = container.querySelector('#import-summary');
      const tripSelect = container.querySelector('#import-trip-select');
      const newTripInput = container.querySelector('#import-new-trip-name');
      const confirmBtn = container.querySelector('#import-confirm-btn');

      // no trips yet: only "+ new trip..." is in the list, so show the
      // name field right away instead of waiting for a change event that
      // will never fire on a single-option select
      if (tripSelect.value === '__new__') newTripInput.style.display = 'block';

      let pending = null; // { payload, photoByName }

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        try {
          pending = await importEntryPackage(file);
          const p = pending.payload;
          const noteCount = (p.annotations || []).length;
          const place = p.city ? `${escapeHtml(p.city)}, ${escapeHtml(p.country || '')}` : escapeHtml(p.country || '');
          summary.innerHTML = `<p class="title">${escapeHtml(p.title || '')}</p><p class="meta">${place} &middot; ${noteCount} note${noteCount === 1 ? '' : 's'}</p>`;
          preview.style.display = 'block';
        } catch (err) {
          alert('Could not read this file: ' + err.message);
          preview.style.display = 'none';
          pending = null;
        }
      });

      tripSelect.addEventListener('change', () => {
        newTripInput.style.display = tripSelect.value === '__new__' ? 'block' : 'none';
      });

      confirmBtn.addEventListener('click', async () => {
        if (!pending) { alert('choose a file first'); return; }
        let tripId;
        if (tripSelect.value === '__new__') {
          const name = newTripInput.value.trim();
          if (!name) { alert('enter a name for the new trip'); return; }
          tripId = await add('trips', { name, start_date: null, end_date: null, is_active: 0 });
        } else {
          if (!tripSelect.value) { alert('choose a trip'); return; }
          tripId = Number(tripSelect.value);
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'importing...';
        try {
          const entryId = await commitImportedEntry(pending.payload, pending.photoByName, tripId);
          noteContentAdded();
          navigate('/entry/' + entryId);
        } catch (err) {
          alert('Import failed: ' + err.message);
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'import entry';
        }
      });
    },
  };
}