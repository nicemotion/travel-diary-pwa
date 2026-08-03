# Travel Diary

An offline-first Progressive Web App for keeping a personal travel diary. Log entries with GPS location, photos, and notes, organized by trip, country, city, and custom tags — all stored locally on your device, with no backend and no server.

## Features

- **Entries** with title, GPS location (auto-detected or manual), country, city, and free-form tags
- **Notes** (photo + text + optional URL) attached to an entry, addable over multiple visits to the same place
- **Trips** as time-bound containers that can span multiple countries
- **Countries** view aggregating entries across all trips, useful for reviewing your history by place rather than by trip
- **Unique search** across text and tags, with live results as you type, distinguishing tag matches from text matches
- **Tag autocomplete** while typing (from the 3rd letter) to avoid near-duplicate tags
- Fully **offline-capable** after the first load (service worker precaches the app shell)
- **Installable** to your phone's home screen like a native app

## Tech stack

Vanilla JavaScript, no build step, no framework, no external libraries or CDNs:

- **IndexedDB** for local storage (data never leaves the device)
- **Geolocation API** for GPS
- **Service Worker** for offline caching
- **Hash-based router** for client-side navigation

## Project structure

```
travel_diary_pwa/
├── index.html            → app shell
├── manifest.json          → PWA name, icons, theme
├── service-worker.js      → offline cache
├── css/style.css
├── icons/
└── js/
    ├── app.js             → bootstrap + route registration
    ├── router.js          → hash-based router
    ├── views.js           → all screens/views
    ├── db.js              → IndexedDB layer
    ├── search.js           → unified text+tag search
    ├── geolocation.js      → GPS wrapper
    ├── seed.js             → sample data for trying the app
    └── icons.js            → inline SVG icons
```

## Running locally

Browsers block ES modules over `file://`, so a local static server is required:

```
python -m http.server 8000
```

Then open `http://localhost:8000` (not `file://...`).

## Privacy

There is no server component. All data is stored in your browser's IndexedDB, scoped to your device. If you share this app with someone else, they get their own empty, independent instance — nothing is shared or synced between users unless built explicitly.

## Backup

Currently manual — there is no automatic export/sync. (Planned: an export/import feature for manual backups.)

## Status

Personal project, actively evolving. Not intended for distribution via app stores.
