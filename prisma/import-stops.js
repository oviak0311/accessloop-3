// Adds every TTC and GO station and stop in prisma/data/stops.json to the database, so riders can
// find any stop by name or stop number and report a barrier there.
//
//   npm run db:import-stops
//
// Safe to run again: stops that are already saved are left where they are, with their reports.
// The list itself is built from the agencies' open data by prisma/build-stops.js.
import fs from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { distanceKm, stopKey, isStation, isWhole } from '../lib/stops.js';

const stops = JSON.parse(fs.readFileSync(new URL('./data/stops.json', import.meta.url), 'utf8'));

async function main() {
  const saved = await prisma.location.findMany();

  const within = (a, b, km) =>
    a.latitude != null && b.latitude != null && distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) <= km;

  const byCode = new Map(saved.filter((l) => l.code).map((l) => [l.code, l]));
  const byName = new Map(); // "kennedy" -> every saved location with that name
  for (const l of saved) {
    const key = stopKey(l.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(l);
  }
  const sameName = (stop) => byName.get(stopKey(stop.name)) ?? [];

  // The saved location this stop already is, if any: the same stop number nearby, or a stop with
  // the same name and direction close by (150 m for a stop, 500 m for a station, which is bigger).
  function findSaved(stop) {
    const sameCode = stop.code ? byCode.get(stop.code) : null;
    if (sameCode && within(sameCode, stop, 1)) return sameCode;
    if (!isWhole(stop)) return null;
    const km = isStation(stop) ? 0.5 : 0.15;
    return sameName(stop).find((l) => isWhole(l) && l.direction === stop.direction && within(l, stop, km)) ?? null;
  }

  // A station already saved by its parts (an elevator, an entrance) keeps the name AccessLoop uses
  // for it, so its whole history stays together.
  function stationName(stop) {
    if (!isStation(stop)) return stop.name;
    return sameName(stop).find((l) => !isWhole(l) && within(l, stop, 0.5))?.name ?? stop.name;
  }

  const usedCodes = new Set(byCode.keys());
  const toAdd = [];
  const updates = [];
  for (const stop of stops) {
    const match = findSaved(stop);
    if (!match) {
      // A stop number can only belong to one stop.
      const code = stop.code && !usedCodes.has(stop.code) ? stop.code : null;
      if (code) usedCodes.add(code);
      toAdd.push({ ...stop, name: stationName(stop), code });
      continue;
    }
    // Already saved: fill in what it's missing. A stop added before this list, when its type was
    // only a guess ("Bus or streetcar stop"), gets its real type, such as GO station.
    const data = {};
    if (!match.line && stop.line) data.line = stop.line;
    if (!match.code && stop.code && !usedCodes.has(stop.code)) {
      data.code = stop.code;
      usedCodes.add(stop.code);
    }
    if (match.type === 'STOP' && isWhole(match) && isWhole(stop) && stop.type !== 'STOP') {
      data.type = stop.type;
      data.spot = stop.spot;
    }
    if (Object.keys(data).length) updates.push({ id: match.id, data });
  }

  let updated = 0;
  for (const { id, data } of updates) {
    try {
      await prisma.location.update({ where: { id }, data });
      updated++;
    } catch (err) {
      if (err.code !== 'P2002') throw err; // P2002: another stop already has that name or number
    }
  }

  // Added 1,000 at a time. skipDuplicates leaves out any stop whose name, spot and direction
  // (or stop number) are already taken, instead of stopping with an error.
  let added = 0;
  for (let i = 0; i < toAdd.length; i += 1000) {
    const { count } = await prisma.location.createMany({ data: toAdd.slice(i, i + 1000), skipDuplicates: true });
    added += count;
    process.stdout.write(`\rAdding stations and stops… ${Math.min(i + 1000, toAdd.length)} of ${toAdd.length}`);
  }
  if (toAdd.length) process.stdout.write('\n');

  const n = (x) => x.toLocaleString('en-CA');
  const already = stops.length - toAdd.length;
  const skipped = toAdd.length - added;
  console.log(`Done: ${n(added)} stations and stops added.`);
  console.log(`  ${n(already)} ${already === 1 ? 'was' : 'were'} already saved (${n(updated)} updated).`);
  if (skipped) console.log(`  ${n(skipped)} left out because a saved stop already has the same name.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
