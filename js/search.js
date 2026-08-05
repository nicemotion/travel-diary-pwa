// search.js — equivalente client-side di search_entries() in app.py

import { getAll, getAllByIndex } from './db.js';

function buildSnippet(text, q, radius = 30) {
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text.length > 60 ? `${text.slice(0, 60)}\u2026` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  let s = text.slice(start, end);
  if (start > 0) s = `\u2026${s}`;
  if (end < text.length) s = `${s}\u2026`;
  return s;
}

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
    const matchedTags = entryTagNames.filter((t) => t.toLowerCase().includes(q));
    const matchesTitle = e.title.toLowerCase().includes(q);
    const matchingTexts = (annotationsByEntry[e.id] || []).filter((t) => t.toLowerCase().includes(q));

    if (matchedTags.length || matchesTitle || matchingTexts.length) {
      // priority mirrors the original badge logic (tag beats text), with an
      // explicit 'title' case added so a title-only match isn't mislabeled
      // as a text match with no real snippet behind it.
      let match_type;
      let match_value = null;
      if (matchedTags.length) {
        match_type = 'tag';
        match_value = matchedTags[0];
      } else if (matchesTitle) {
        match_type = 'title';
      } else {
        match_type = 'text';
        match_value = buildSnippet(matchingTexts[0], q);
      }

      results.push({
        ...e,
        country_name: countryById[e.country_id]?.name || '',
        match_type,
        match_value,
      });
    }
  }

  results.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return results;
}
