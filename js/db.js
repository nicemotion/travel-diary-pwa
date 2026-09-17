// db.js — sostituisce sqlite3/schema.sql. Il database vive nel browser (IndexedDB),
// isolato per dispositivo/utente: nessun server, nessun dato condiviso.

const DB_NAME = 'travel_diary';
const DB_VERSION = 1;
let dbInstance = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      const trips = db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
      trips.createIndex('start_date', 'start_date');

      const countries = db.createObjectStore('countries', { keyPath: 'id', autoIncrement: true });
      countries.createIndex('name', 'name', { unique: true });

      const entries = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      entries.createIndex('trip_id', 'trip_id');
      entries.createIndex('country_id', 'country_id');
      entries.createIndex('created_at', 'created_at');

      const tags = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
      tags.createIndex('name', 'name', { unique: true });

      const entryTags = db.createObjectStore('entry_tags', { keyPath: 'id', autoIncrement: true });
      entryTags.createIndex('entry_id', 'entry_id');
      entryTags.createIndex('tag_id', 'tag_id');

      const annotations = db.createObjectStore('annotations', { keyPath: 'id', autoIncrement: true });
      annotations.createIndex('entry_id', 'entry_id');
    };

    req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeNames, mode) {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

// ---------- helper generici ----------

export async function getAll(store) {
  const t = await tx([store], 'readonly');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getById(store, id) {
  const t = await tx([store], 'readonly');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).get(Number(id));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllByIndex(store, indexName, value) {
  const t = await tx([store], 'readonly');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function add(store, obj) {
  const t = await tx([store], 'readwrite');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).add(obj);
    req.onsuccess = () => resolve(req.result); // id generato
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, obj) {
  const t = await tx([store], 'readwrite');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(store, id) {
  const t = await tx([store], 'readwrite');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).delete(Number(id));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const stores = ['trips', 'countries', 'entries', 'tags', 'entry_tags', 'annotations'];
  const t = await tx(stores, 'readwrite');
  stores.forEach((s) => t.objectStore(s).clear());
  return new Promise((resolve) => { t.oncomplete = () => resolve(); });
}

// ---------- helper di dominio ----------

export async function findOrCreateCountry(name) {
  const all = await getAll('countries');
  const existing = all.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  return add('countries', { name });
}

export async function findOrCreateTag(name) {
  const all = await getAll('tags');
  const existing = all.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  return add('tags', { name });
}

export async function setEntryTags(entryId, tagNames) {
  // rimuove i vecchi collegamenti e ricrea quelli nuovi
  const existingLinks = await getAllByIndex('entry_tags', 'entry_id', Number(entryId));
  for (const link of existingLinks) await remove('entry_tags', link.id);

  for (const raw of tagNames) {
    const name = raw.trim().replace(/^#/, '');
    if (!name) continue;
    const tagId = await findOrCreateTag(name);
    await add('entry_tags', { entry_id: Number(entryId), tag_id: tagId });
  }
}

export async function getEntryTagNames(entryId) {
  const links = await getAllByIndex('entry_tags', 'entry_id', Number(entryId));
  const allTags = await getAll('tags');
  const tagById = Object.fromEntries(allTags.map((t) => [t.id, t.name]));
  return links.map((l) => tagById[l.tag_id]).filter(Boolean);
}

// renames a tag everywhere it's used. if the new name collides with an
// existing tag (case-insensitive), merges into it instead: links move over
// (dropping any that would duplicate an entry/tag pair) and the old tag row
// is removed, so the same entry never ends up double-tagged.
export async function renameTag(tagId, newName) {
  const name = newName.trim();
  if (!name) return;
  const tag = await getById('tags', tagId);
  if (!tag) return;
  if (name.toLowerCase() === tag.name.toLowerCase()) {
    if (name !== tag.name) await put('tags', { ...tag, name });
    return;
  }
  const all = await getAll('tags');
  const clash = all.find((t) => t.id !== tagId && t.name.toLowerCase() === name.toLowerCase());
  if (!clash) {
    await put('tags', { ...tag, name });
    return;
  }
  const links = await getAllByIndex('entry_tags', 'tag_id', tagId);
  for (const link of links) {
    const entryLinks = await getAllByIndex('entry_tags', 'entry_id', link.entry_id);
    const alreadyHasClash = entryLinks.some((l) => l.tag_id === clash.id);
    if (alreadyHasClash) await remove('entry_tags', link.id);
    else await put('entry_tags', { ...link, tag_id: clash.id });
  }
  await remove('tags', tagId);
}

// deletes a tag and un-tags every entry that had it; the entries themselves
// (and their notes) are left untouched.
export async function deleteTag(tagId) {
  const links = await getAllByIndex('entry_tags', 'tag_id', tagId);
  for (const link of links) await remove('entry_tags', link.id);
  await remove('tags', tagId);
}

export async function deleteEntryCascade(entryId) {
  const id = Number(entryId);
  const entry = await getById('entries', id);

  const links = await getAllByIndex('entry_tags', 'entry_id', id);
  const tagIds = [...new Set(links.map((l) => l.tag_id))];
  for (const l of links) await remove('entry_tags', l.id);

  const anns = await getAllByIndex('annotations', 'entry_id', id);
  for (const a of anns) await remove('annotations', a.id);

  await remove('entries', id);

  // a tag with no entries left pointing to it is orphaned — drop it so it
  // doesn't linger in Explore/Tags with a permanent "0 entries"
  for (const tagId of tagIds) {
    const stillUsed = await getAllByIndex('entry_tags', 'tag_id', tagId);
    if (stillUsed.length === 0) await remove('tags', tagId);
  }

  // same idea for the country: if this was its last entry (across ALL
  // trips, not just the one being deleted), drop it too
  if (entry && entry.country_id != null) {
    const remainingInCountry = await getAllByIndex('entries', 'country_id', entry.country_id);
    if (remainingInCountry.length === 0) await remove('countries', entry.country_id);
  }
}

// one-time (or periodic) cleanup for orphans that predate the fix in
// deleteEntryCascade above — safe to call anytime, only removes a country/
// tag that genuinely has zero entries referencing it right now
export async function sweepOrphans() {
  const [countries, entries, tags, entryTags] = await Promise.all([
    getAll('countries'), getAll('entries'), getAll('tags'), getAll('entry_tags'),
  ]);

  const usedCountryIds = new Set(entries.map((e) => e.country_id).filter((v) => v != null));
  for (const c of countries) {
    if (!usedCountryIds.has(c.id)) await remove('countries', c.id);
  }

  const usedTagIds = new Set(entryTags.map((l) => l.tag_id));
  for (const t of tags) {
    if (!usedTagIds.has(t.id)) await remove('tags', t.id);
  }
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
