// tiles.js — offline map tile caching (IndexedDB), a Leaflet layer that reads
// from that cache first, and helpers to pre-download tiles around a set of
// GPS points before a trip. Kept fully separate from db.js: this is a
// regenerable cache, not user data, so it's not part of backup/restore.

const TILE_DB_NAME = 'travel_diary_tiles';
const TILE_DB_VERSION = 1;
const TILE_STORE = 'tiles';
const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// 1x1 transparent png, used when a tile is neither cached nor reachable —
// avoids the broken-image icon while offline.
const BLANK_TILE_SRC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let dbPromise = null;

export function openTileDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(TILE_DB_NAME, TILE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getCachedTile(key) {
  const db = await openTileDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TILE_STORE, 'readonly');
    const req = tx.objectStore(TILE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function putCachedTile(key, blob) {
  const db = await openTileDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TILE_STORE, 'readwrite');
    tx.objectStore(TILE_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function countCachedTiles() {
  const db = await openTileDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TILE_STORE, 'readonly');
    const req = tx.objectStore(TILE_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

function tileUrl(z, x, y) {
  return TILE_URL_TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// custom tile layer: cache-first, falls back to network, then caches what
// it fetched. If offline and not cached, shows a blank tile instead of a
// broken-image icon.
export function createOfflineTileLayer(options) {
  const OfflineTileLayer = L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('img');
      tile.setAttribute('role', 'presentation');
      const key = tileKey(coords.z, coords.x, coords.y);

      getCachedTile(key).then((cached) => {
        if (cached) {
          tile.src = URL.createObjectURL(cached);
          done(null, tile);
          return;
        }
        const url = tileUrl(coords.z, coords.x, coords.y);
        fetch(url)
          .then((res) => {
            if (!res.ok) throw new Error('tile fetch failed');
            return res.blob();
          })
          .then((blob) => {
            putCachedTile(key, blob).catch(() => {});
            tile.src = URL.createObjectURL(blob);
            done(null, tile);
          })
          .catch(() => {
            tile.src = BLANK_TILE_SRC;
            done(null, tile);
          });
      }).catch(() => {
        tile.src = BLANK_TILE_SRC;
        done(null, tile);
      });

      return tile;
    },
  });

  return new OfflineTileLayer(TILE_URL_TEMPLATE, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ...options,
  });
}

// TEST/PROVA — overlay con le sole etichette in inglese (Carto), sempre
// online (mai passa dalla cache IndexedDB). Va sovrapposto sopra il layer
// base esistente: NON sostituisce le etichette locali gia' disegnate nei
// pixel della tile OSM standard, quindi in alcune zone si vedra' testo
// doppio (locale + inglese). E' solo per valutare il risultato: se non va
// bene si rimuove la riga che la aggiunge in views.js, senza altri effetti.
export function createEnglishLabelsOverlay() {
  return L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
      pane: 'overlayPane',
    }
  );
}

// ---------- pre-download around points ----------

function lon2tileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

// plans the set of tiles ("z/x/y" keys) covering a small radius (km) around
// each point, across a zoom range. Deduplicates tiles shared between nearby
// points with a Set. Deliberately does NOT cover the bounding box of all
// points together — that could be huge if entries are spread across a
// whole country.
export function planDownloadAroundPoints(points, radiusKm = 1, minZoom = 13, maxZoom = 17) {
  const keys = new Set();
  for (const p of points) {
    if (p == null || p.lat == null || p.lon == null) continue;
    const latDelta = radiusKm / 111.32;
    const cosLat = Math.cos((p.lat * Math.PI) / 180) || 0.0001;
    const lonDelta = radiusKm / (111.32 * Math.abs(cosLat));

    for (let z = minZoom; z <= maxZoom; z++) {
      const xMin = lon2tileX(p.lon - lonDelta, z);
      const xMax = lon2tileX(p.lon + lonDelta, z);
      // latitude increases northward but tile y increases southward
      const yMin = lat2tileY(p.lat + latDelta, z);
      const yMax = lat2tileY(p.lat - latDelta, z);
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          keys.add(tileKey(z, x, y));
        }
      }
    }
  }
  return [...keys];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// downloads a list of "z/x/y" tile keys, skipping ones already cached, with
// a short pause between network requests so we don't hammer OSM's free
// tile server. Calls onProgress(done, total) after every tile (cached or
// freshly downloaded) so the caller can show "downloaded X of Y".
export async function downloadTiles(tileKeys, onProgress) {
  const total = tileKeys.length;
  let done = 0;
  for (const key of tileKeys) {
    const already = await getCachedTile(key);
    if (!already) {
      const [z, x, y] = key.split('/');
      try {
        const res = await fetch(tileUrl(z, x, y));
        if (res.ok) {
          const blob = await res.blob();
          await putCachedTile(key, blob);
        }
      } catch {
        // offline or request failed — just skip this tile, it'll be
        // fetched on the fly (or shown blank) when actually viewed
      }
      await sleep(120);
    }
    done++;
    if (onProgress) onProgress(done, total);
  }
  return done;
}
