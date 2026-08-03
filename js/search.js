// search.js — equivalente client-side di search_entries() in app.py

import { getAll, getAllByIndex } from './db.js';

export async function searchEntries(query, tripId = null, countryId = null) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [entries, countries, tags, entryTags, annotations] = await Promise.all([
    getAll('entries'), getAll('countries'), getAll('tags'), getAll('entry_tags'), getAll('annotations'),
  ]);

  const countryById = Object.fromEntries(countries.map((c) => [c.id, c]));
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));

  const tagsByEntry = {};
  for (const link of entryTags) {
    (tagsByEntry[link.entry_id] ||= []).push(tagById[link.tag_id]?.name || '');
  }
  const annotationsByEntry = {};
  for (const a of annotations) {
    (annotationsByEntry[a.entry_id] ||= []).push(a.text || '');
  }

  let pool = entries;
  if (tripId !== null) pool = pool.filter((e) => e.trip_id === Number(tripId));
  if (countryId !== null) pool = pool.filter((e) => e.country_id === Number(countryId));

  const results = [];
  for (const e of pool) {
    const entryTagNames = tagsByEntry[e.id] || [];
    const matchesTag = entryTagNames.some((t) => t.toLowerCase().includes(q));
    const matchesTitle = e.title.toLowerCase().includes(q);
    const matchesText = (annotationsByEntry[e.id] || []).some((t) => t.toLowerCase().includes(q));

    if (matchesTag || matchesTitle || matchesText) {
      results.push({
        ...e,
        country_name: countryById[e.country_id]?.name || '',
        match_type: matchesTag ? 'tag' : 'text',
      });
    }
  }

  results.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return results;
}
