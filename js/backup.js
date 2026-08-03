// backup.js — manual local backup: export all IndexedDB data (+ photos) to a
// downloadable .zip, and restore from one. No server involved.

import { getAll, clearAll } from './db.js';
import { createZip, readZip } from './zip.js';

const TABLES = ['trips', 'countries', 'entries', 'tags', 'entry_tags', 'annotations'];

export async function exportBackup() {
  const data = {};
  for (const table of TABLES) data[table] = await getAll(table);

  // pull photo blobs out of annotations, store as separate zip entries,
  // replace with a filename reference in the JSON
  const zipEntries = [];
  for (const a of data.annotations) {
    if (a.photo_blob) {
      const filename = `photos/annotation_${a.id}.jpg`;
      const bytes = new Uint8Array(await a.photo_blob.arrayBuffer());
      zipEntries.push({ name: filename, data: bytes });
      a.photo_file = filename;
      delete a.photo_blob;
    }
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  zipEntries.unshift({ name: 'data.json', data: jsonBytes });

  const zipBlob = createZip(zipEntries);

  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `travel-diary-backup-${stamp}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function importBackup(file) {
  const entries = await readZip(file);
  const dataEntry = entries.find((e) => e.name === 'data.json');
  if (!dataEntry) throw new Error('data.json not found in this zip — not a valid backup file');

  const data = JSON.parse(new TextDecoder().decode(dataEntry.data));
  const photoByName = new Map();
  for (const e of entries) {
    if (e.name.startsWith('photos/')) {
      photoByName.set(e.name, new Blob([e.data], { type: 'image/jpeg' }));
    }
  }

  await clearAll();

  // re-insert in dependency order, preserving original ids so relations stay intact
  for (const table of TABLES) {
    for (const row of data[table] || []) {
      const record = { ...row };
      if (table === 'annotations' && record.photo_file) {
        record.photo_blob = photoByName.get(record.photo_file) || null;
        delete record.photo_file;
      }
      await addWithId(table, record);
    }
  }
}

// IndexedDB's `add` normally lets the store auto-generate an id; here we need
// to preserve the *original* id so foreign keys (trip_id, entry_id, tag_id...)
// still point to the right row after a restore.
async function addWithId(table, record) {
  const { openDB } = await import('./db.js');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([table], 'readwrite');
    const req = tx.objectStore(table).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
