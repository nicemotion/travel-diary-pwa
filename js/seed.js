// seed.js — sample demo data (English), same structure used to test the Flask version

import { add, findOrCreateCountry, setEntryTags } from './db.js';

export async function seedDemoData() {
  const tripSea = await add('trips', { name: 'Southeast Asia 2026', start_date: '2026-07-10', end_date: null, is_active: 1 });
  const tripJp = await add('trips', { name: 'Japan 2024', start_date: '2024-03-05', end_date: '2024-04-02', is_active: 0 });
  const tripTh19 = await add('trips', { name: 'Thailand 2019', start_date: '2019-01-08', end_date: '2019-01-22', is_active: 0 });

  const countryTh = await findOrCreateCountry('Thailand');
  const countryJp = await findOrCreateCountry('Japan');

  async function addEntry(tripId, countryId, title, city, createdAt, lat, lon, tags, annotations) {
    const id = await add('entries', { trip_id: tripId, country_id: countryId, title, city, created_at: createdAt, lat, lon });
    await setEntryTags(id, tags);
    for (const a of annotations) {
      await add('annotations', { entry_id: id, text: a.text || null, url: a.url || null, photo_blob: null, timestamp: a.timestamp });
    }
    return id;
  }

  await addEntry(tripSea, countryTh, 'Fish restaurant', 'Bangkok', '2026-07-15T19:00', 13.7563, 100.5018,
    ['restaurants', 'seafood'], [
      { text: 'this is the alley entrance', timestamp: '2026-07-15T19:02' },
      { text: 'interesting menu, come back for dinner', timestamp: '2026-07-15T19:14' },
      { url: 'https://fishrestaurantsite.com', timestamp: '2026-07-17T09:40' },
    ]);

  await addEntry(tripSea, countryTh, 'Riverside park', 'Bangkok', '2026-07-14T10:30', 13.76, 100.509,
    ['parks'], [
      { text: 'nice park, shaded benches', timestamp: '2026-07-14T10:32' },
      { text: 'great for a sunset walk', timestamp: '2026-07-14T18:05' },
    ]);

  await addEntry(tripSea, countryTh, 'Songthaew stop', 'Bangkok', '2026-07-14T08:15', 13.755, 100.495,
    ['transport'], [{ text: 'comes about every 15 minutes, 10 baht a ride', timestamp: '2026-07-14T08:16' }]);

  await addEntry(tripJp, countryJp, 'Senso-ji Temple', 'Tokyo', '2024-03-10T09:00', 35.7148, 139.7967,
    ['temples', 'sightseeing'], [
      { text: 'better to arrive early to avoid crowds', timestamp: '2024-03-10T09:05' },
      { text: 'incense and omikuji fortunes worth trying', timestamp: '2024-03-10T09:40' },
    ]);

  await addEntry(tripJp, countryJp, 'Ichiran Ramen Shibuya', 'Tokyo', '2024-03-12T20:00', 35.6595, 139.7005,
    ['restaurants', 'ramen'], [
      { text: 'order from a vending machine, single booths', timestamp: '2024-03-12T20:05' },
      { text: 'great tonkotsu broth, come back', timestamp: '2024-03-12T20:45' },
    ]);

  await addEntry(tripJp, countryJp, 'TeamLab Planets', 'Tokyo', '2024-03-15T14:00', 35.6497, 139.793,
    ['art', 'experiences'], [{ text: 'wear comfortable clothes, you walk barefoot', timestamp: '2024-03-15T14:02' }]);

  await addEntry(tripTh19, countryTh, 'Chiang Mai night market', 'Chiang Mai', '2019-01-12T19:30', 18.7883, 98.9853,
    ['markets', 'street food'], [{ text: 'pad thai at the stall in the back, great and cheap', timestamp: '2019-01-12T19:40' }]);

  await addEntry(tripTh19, countryTh, 'Wat Phra Kaew Temple', 'Bangkok', '2019-01-15T08:00', 13.7515, 100.4927,
    ['temples', 'sightseeing'], [
      { text: 'strict dress code: shoulders and knees covered', timestamp: '2019-01-15T08:05' },
      { text: 'better with a guide to understand the history', timestamp: '2019-01-15T10:20' },
    ]);

  await addEntry(tripTh19, countryTh, 'Koh Samet Island', null, '2019-01-18T11:00', 12.5683, 101.4506,
    ['beaches'], [{ text: 'crystal clear water, less crowded than Phuket', timestamp: '2019-01-18T11:10' }]);
}
