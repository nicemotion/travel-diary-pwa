// share.js — share a single entry with someone else, two ways:
//   1) a .zip package (same JSON+photos scheme as backup.js, scoped to one
//      entry) that another Travel Diary install can import directly
//   2) a standalone, self-contained .html file — openable in any browser,
//      no app required — for people who don't have Travel Diary
// Both go through the Web Share API when available (native share sheet:
// mail, WhatsApp, Telegram, etc.), falling back to a plain download.

import {
  getById, getAllByIndex, add, findOrCreateCountry, setEntryTags, getEntryTagNames,
} from './db.js';
import { createZip, readZip } from './zip.js';

async function buildEntryPayload(entryId) {
  const entry = await getById('entries', entryId);
  if (!entry) throw new Error('entry not found');
  const [country, tagNames, annotations] = await Promise.all([
    getById('countries', entry.country_id),
    getEntryTagNames(entryId),
    getAllByIndex('annotations', 'entry_id', entryId),
  ]);
  annotations.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { entry, countryName: country ? country.name : '', tagNames, annotations };
}

function slugify(s) {
  return (s || 'entry')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'entry';
}

// ---------- .zip package: for import into another Travel Diary install ----------

export async function exportEntryZip(entryId) {
  const { entry, countryName, tagNames, annotations } = await buildEntryPayload(entryId);

  const zipEntries = [];
  const annData = [];
  for (const a of annotations) {
    const row = { text: a.text || null, url: a.url || null, timestamp: a.timestamp, photo_file: null };
    if (a.photo_blob) {
      const filename = `photos/annotation_${a.id}.jpg`;
      const bytes = new Uint8Array(await a.photo_blob.arrayBuffer());
      zipEntries.push({ name: filename, data: bytes });
      row.photo_file = filename;
    }
    annData.push(row);
  }

  // country/city/tags travel as plain names/strings, not local ids — the
  // receiving device has its own id space and will find-or-create them
  const payload = {
    format: 'travel-diary-entry',
    version: 1,
    title: entry.title,
    country: countryName,
    city: entry.city || null,
    lat: entry.lat ?? null,
    lon: entry.lon ?? null,
    created_at: entry.created_at,
    tags: tagNames,
    annotations: annData,
  };
  zipEntries.unshift({ name: 'entry.json', data: new TextEncoder().encode(JSON.stringify(payload, null, 2)) });

  const blob = createZip(zipEntries);
  return { blob, filename: `${slugify(entry.title)}.tdentry.zip` };
}

// reads a shared .zip package and returns its parsed payload + photo blobs,
// without touching the local database yet (the caller lets the user pick a
// trip first via commitImportedEntry).
export async function importEntryPackage(file) {
  const entries = await readZip(file);
  const dataEntry = entries.find((e) => e.name === 'entry.json');
  if (!dataEntry) throw new Error('entry.json not found — not a valid Travel Diary entry file');

  const payload = JSON.parse(new TextDecoder().decode(dataEntry.data));
  if (payload.format !== 'travel-diary-entry') throw new Error('unrecognized file format');

  const photoByName = new Map();
  for (const e of entries) {
    if (e.name.startsWith('photos/')) photoByName.set(e.name, new Blob([e.data], { type: 'image/jpeg' }));
  }
  return { payload, photoByName };
}

export async function commitImportedEntry(payload, photoByName, tripId) {
  const countryId = await findOrCreateCountry(payload.country || 'Unknown');
  const entryId = await add('entries', {
    trip_id: tripId,
    country_id: countryId,
    title: payload.title || 'Imported entry',
    city: payload.city || null,
    lat: payload.lat ?? null,
    lon: payload.lon ?? null,
    created_at: payload.created_at || new Date().toISOString().slice(0, 16),
  });
  await setEntryTags(entryId, payload.tags || []);
  for (const a of payload.annotations || []) {
    await add('annotations', {
      entry_id: entryId,
      text: a.text || null,
      url: a.url || null,
      photo_blob: a.photo_file ? (photoByName.get(a.photo_file) || null) : null,
      timestamp: a.timestamp || payload.created_at || new Date().toISOString().slice(0, 16),
    });
  }
  return entryId;
}

// ---------- standalone .html: readable without the app ----------

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportEntryHtml(entryId) {
  const { entry, countryName, tagNames, annotations } = await buildEntryPayload(entryId);

  const annHtml = [];
  for (const a of annotations) {
    let photoHtml = '';
    if (a.photo_blob) {
      const dataUrl = await blobToDataUrl(a.photo_blob);
      photoHtml = `<img src="${dataUrl}" alt="">`;
    }
    annHtml.push(`
      <div class="note">
        ${photoHtml}
        ${a.text ? `<p class="text">${escapeHtml(a.text)}</p>` : ''}
        ${a.url ? `<p class="url"><a href="${escapeHtml(a.url)}">${escapeHtml(a.url)}</a></p>` : ''}
        <p class="time">${escapeHtml(a.timestamp)}</p>
      </div>`);
  }

  const place = entry.city ? `${escapeHtml(entry.city)}, ${escapeHtml(countryName)}` : escapeHtml(countryName);
  const mapLink = (entry.lat != null && entry.lon != null)
    ? `<p class="meta"><a href="https://maps.google.com/?q=${entry.lat},${entry.lon}">open on Google Maps (${entry.lat.toFixed(4)}, ${entry.lon.toFixed(4)})</a></p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(entry.title)} \u2014 Travel Diary</title>
<style>
  body { font-family: Verdana, Geneva, sans-serif; background:#eef2f5; color:#1a1a1a; margin:0; padding:0; }
  .wrap { max-width:600px; margin:0 auto; background:#ceee96; min-height:100vh; }
  .header { background:#144565; color:#fff; padding:20px 18px; }
  .header .badge { font-size:11px; background:rgba(255,255,255,0.15); padding:3px 9px; border-radius:20px; display:inline-block; margin-bottom:8px; }
  .header h1 { margin:4px 0 4px; font-size:22px; }
  .header .meta { font-size:12px; color:#cfe0ec; margin:0; }
  .content { padding:16px 18px 40px; }
  .tags { margin: 10px 0; }
  .tags span { font-size:11px; background:#dce8f0; color:#0d3049; padding:3px 9px; border-radius:20px; margin-right:4px; display:inline-block; }
  .meta a { color:#144565; }
  .notes-label { font-size:12px; color:#64707a; margin-top:16px; }
  .note { background:#fff; border:1px solid #d7dee3; border-radius:12px; padding:12px; margin-bottom:10px; }
  .note img { width:100%; border-radius:8px; margin-bottom:8px; display:block; }
  .note .text { margin:0 0 6px; font-size:14px; }
  .note .url { margin:0 0 6px; font-size:13px; word-break:break-all; }
  .note .time { margin:0; font-size:11px; color:#64707a; }
  .footer { text-align:center; font-size:11px; color:#64707a; padding:20px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <span class="badge">${place}</span>
      <h1>${escapeHtml(entry.title)}</h1>
      <p class="meta">${escapeHtml(entry.created_at)}</p>
    </div>
    <div class="content">
      ${tagNames.length ? `<div class="tags">${tagNames.map((t) => `<span>#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      ${mapLink}
      <p class="notes-label">notes (${annotations.length})</p>
      ${annHtml.join('') || '<p class="meta">no notes for this entry.</p>'}
    </div>
    <div class="footer">shared from Travel Diary</div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  return { blob, filename: `${slugify(entry.title)}.html` };
}

// ---------- sharing helper: Web Share API with a file, falls back to download ----------

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// returns 'shared' | 'downloaded' | 'cancelled'
export async function shareOrDownload(blob, filename, { title, text } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // any other share failure: fall through to a plain download
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}