// Adds every station and stop in prisma/data/stops.json (TTC, GO, MiWay, Brampton Transit, York
// Region Transit and Durham Region Transit) to the database, so riders can find any stop by its
// name or stop number and report a barrier there.
//
//   npm run db:import-stops
//
// Safe to run again: stops that are already saved are left where they are, with their reports.
// The list itself is built from the agencies' open data by prisma/build-stops.js.
import fs from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { distanceKm, stopKey, isStation, isWhole } from '../lib/stops.js';
import { AGENCY_LABELS } from '../lib/rules.js';

const stops = JSON.parse(fs.readFileSync(new URL('./data/stops.json', import.meta.url), 'utf8'));

async function main() {
  const saved = await prisma.location.findMany();

  const within = (a, b, km) =>
    a.latitude != null && b.latitude != null && distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) <= km;

  const byCode = new Map(); // "1234" -> saved locations with that stop number (any agency)
  const byName = new Map(); // "kennedy" -> saved locations with that name
  const addTo = (map, key, l) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  };
  for (const l of saved) {
    if (l.code) addTo(byCode, l.code, l);
    addTo(byName, stopKey(l.name), l);
  }

  // A saved stop can only be one stop from the list: one from the same agency, or from any agency
  // if it was saved before agencies were recorded.
  const claimed = new Set();
  const available = (l, stop) => !claimed.has(l.id) && (!l.agency || l.agency === stop.agency);

  // The saved location this stop already is, if any: the same stop number within 150 m, or a
  // stop with the same name and direction close by (150 m for a stop, 500 m for a station).
  function findSaved(stop) {
    const sameNumber = (byCode.get(stop.code) ?? []).find((l) => available(l, stop) && within(l, stop, 0.15));
    if (sameNumber) return sameNumber;
    if (!isWhole(stop)) return null;
    const km = isStation(stop) ? 0.5 : 0.15;
    const sameName = byName.get(stopKey(stop.name)) ?? [];
    return (
      sameName.find(
        (l) =>
          available(l, stop) &&
          isWhole(l) &&
          l.direction === stop.direction &&
          within(l, stop, km) &&
          (!l.code || !stop.code || l.code === stop.code),
      ) ?? null
    );
  }

  // A station already saved by its parts (an elevator, an entrance) keeps the name AccessLoop uses
  // for it, so its whole history stays together.
  function stationName(stop) {
    if (!isStation(stop)) return stop.name;
    const parts = (byName.get(stopKey(stop.name)) ?? []).filter((l) => !isWhole(l) && within(l, stop, 0.5));
    return parts[0]?.name ?? stop.name;
  }

  // First, find which stops are already saved. Going agency by agency, TTC first, means a stop
  // saved before agencies were recorded goes to its own agency's stop, even where another agency
  // shares the pole and its number (Durham's Pulse buses use TTC stops in Scarborough).
  const order = Object.keys(AGENCY_LABELS);
  const byAgency = stops.map((stop, i) => i).sort((x, y) => order.indexOf(stops[x].agency) - order.indexOf(stops[y].agency));
  const matches = [];
  for (const i of byAgency) {
    matches[i] = findSaved(stops[i]);
    if (matches[i]) claimed.add(matches[i].id);
  }

  // Stop numbers already taken in each agency ("TTC|1234"), counting saved stops that are about
  // to get their agency. A number can only belong to one stop in each agency.
  const usedCodes = new Set();
  for (const l of saved) if (l.code && l.agency) usedCodes.add(`${l.agency}|${l.code}`);
  stops.forEach((stop, i) => matches[i]?.code && usedCodes.add(`${stop.agency}|${matches[i].code}`));
  const takeCode = (stop) => {
    const key = `${stop.agency}|${stop.code}`;
    if (!stop.code || usedCodes.has(key)) return null;
    usedCodes.add(key);
    return stop.code;
  };

  const toAdd = [];
  const updates = [];
  stops.forEach((stop, i) => {
    const match = matches[i];
    if (!match) {
      toAdd.push({ ...stop, name: stationName(stop), code: takeCode(stop) });
      return;
    }
    // Already saved: fill in what it's missing. A stop added before this list, when its type was
    // only a guess ("Bus or streetcar stop"), gets its real type, such as GO station.
    const data = {};
    if (!match.agency) data.agency = stop.agency;
    if (!match.line && stop.line) data.line = stop.line;
    if (!match.code) {
      const code = takeCode(stop);
      if (code) data.code = code;
    }
    if (match.type === 'STOP' && isWhole(match) && isWhole(stop) && stop.type !== 'STOP') {
      data.type = stop.type;
      data.spot = stop.spot;
    }
    if (Object.keys(data).length) updates.push({ id: match.id, data });
  });

  // Most updates are the same change (setting the agency), so stops that need the same change
  // are updated together, 1,000 at a time. That's far quicker than one at a time.
  const updateOne = async (id, data) => {
    try {
      await prisma.location.update({ where: { id }, data });
      return 1;
    } catch (err) {
      if (err.code !== 'P2002') throw err; // P2002: another stop already has that name, or that agency and number
      return 0;
    }
  };
  const sameChange = new Map(); // the change as text -> ids of the stops that need it
  for (const { id, data } of updates) addTo(sameChange, JSON.stringify(data), id);
  let updated = 0;
  if (updates.length) console.log(`Updating ${updates.length.toLocaleString('en-CA')} saved stops…`);
  for (const [change, ids] of sameChange) {
    const data = JSON.parse(change);
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      try {
        updated += (await prisma.location.updateMany({ where: { id: { in: chunk } }, data })).count;
      } catch (err) {
        if (err.code !== 'P2002') throw err;
        for (const id of chunk) updated += await updateOne(id, data); // find the one that clashes
      }
    }
  }

  // Added 1,000 at a time. skipDuplicates leaves out any stop whose name, spot and direction
  // (or agency and stop number) are already taken, instead of stopping with an error.
  let added = 0;
  for (let i = 0; i < toAdd.length; i += 1000) {
    const { count } = await prisma.location.createMany({ data: toAdd.slice(i, i + 1000), skipDuplicates: true });
    added += count;
    process.stdout.write(`\rAdding stations and stops… ${Math.min(i + 1000, toAdd.length).toLocaleString('en-CA')} of ${toAdd.length.toLocaleString('en-CA')}`);
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
