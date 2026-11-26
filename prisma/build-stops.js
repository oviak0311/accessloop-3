// Builds prisma/data/stops.json, the list of stations and stops that `npm run db:import-stops`
// adds to the database.
//
// It reads each transit agency's open schedule data (GTFS): stops.txt for names and positions,
// and routes.txt, trips.txt and stop_times.txt to work out which routes serve each stop and which
// way they travel. Run it again with newer files to refresh the list (any agency left out is skipped):
//
//   node prisma/build-stops.js --ttc <folder> --go <folder> --miway <folder> --brampton <folder> --yrt <folder> --drt <folder>
//
// Sources: TTC (City of Toronto Open Data), GO Transit (Metrolinx), MiWay (City of Mississauga),
// Brampton Transit, York Region Transit and Durham Region Transit.
import fs from 'node:fs';
import readline from 'node:readline';
import { LOCATION_TYPE_LABELS, SERVICE_AREA } from '../lib/rules.js';

const args = {}; // --ttc <folder> --go <folder> …
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const OUT = new URL('./data/stops.json', import.meta.url);

// ---------- Tidying names ----------

// "HWY 7 / MARTIN GROVE" -> "Hwy 7 / Martin Grove". Initials like GO and VMC stay in capitals.
const KEEP_CAPITALS = new Set(['GO', 'VMC', 'YRT', 'TTC', 'II', 'III', 'IV']);
function titleCase(text) {
  return text
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-z])/g, (m, before, letter) => before + letter.toUpperCase())
    .replace(/\b(Mc|O')([a-z])/g, (m, start, letter) => start + letter.toUpperCase())
    .replace(/\b[A-Za-z]+\b/g, (word) => (KEEP_CAPITALS.has(word.toUpperCase()) ? word.toUpperCase() : word));
}

const DIRECTIONS = {
  n: 'NORTHBOUND', nb: 'NORTHBOUND', north: 'NORTHBOUND', northbound: 'NORTHBOUND',
  s: 'SOUTHBOUND', sb: 'SOUTHBOUND', south: 'SOUTHBOUND', southbound: 'SOUTHBOUND',
  e: 'EASTBOUND', eb: 'EASTBOUND', east: 'EASTBOUND', eastbound: 'EASTBOUND',
  w: 'WESTBOUND', wb: 'WESTBOUND', west: 'WESTBOUND', westbound: 'WESTBOUND',
};
const toDirection = (word) => DIRECTIONS[String(word ?? '').trim().toLowerCase()] ?? null;

// ---------- The agencies ----------
// Each agency writes its trip headsigns its own way, so each one says where the direction is.
// The order matters: when two agencies' stops share a name, the first agency's keeps it plain.
const AGENCIES = [
  // "East - 10 Van Horne towards Victoria Park"
  { id: 'TTC', arg: 'ttc', direction: (t) => t.trip_headsign.split(/[\s-]/)[0] },
  // GO doesn't give directions
  { id: 'GO', arg: 'go', direction: () => null, linePrefix: 'GO bus ' },
  // "1 E Dundas To Kipling Terminal"
  { id: 'MIWAY', arg: 'miway', direction: (t) => t.trip_headsign.split(' ')[1] },
  // "9 VODDEN EAST"
  { id: 'BRAMPTON', arg: 'brampton', direction: (t) => t.trip_headsign.split(' ').pop() },
  // "Newmarket Terminal - NB", with stop names in capitals ("HWY 7 / MARTIN GROVE")
  { id: 'YRT', arg: 'yrt', direction: (t) => t.trip_headsign.split(' - ').pop(), name: titleCase },
  // direction_name is "Northbound". Stop names repeat it ("Garden Northbound @ Bassett"), so it's
  // taken out of the name: the label shows the direction already.
  {
    id: 'DRT',
    arg: 'drt',
    direction: (t) => t.direction_name,
    name: (n) => n.replace(/\s+(north|south|east|west)bound\b/i, ''),
  },
];

// ---------- Reading GTFS files ----------

// Splits one CSV line, allowing for "quoted, values".
function splitCsv(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') out.push(field), (field = '');
    else field += c;
  }
  out.push(field);
  return out;
}

// Calls onRow(object) for every row, streaming, so the large stop_times.txt is never fully in memory.
async function eachRow(file, onRow) {
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let header = null;
  for await (const raw of lines) {
    const line = raw.replace(/^﻿/, '');
    if (!line.trim()) continue;
    const cells = splitCsv(line);
    if (!header) {
      header = cells.map((h) => h.trim());
      continue;
    }
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
    onRow(row);
  }
}

// For one agency: its routes, and for each stop, the routes that serve it and the directions
// its trips are heading.
async function readAgency(folder, agency) {
  const routes = new Map();
  await eachRow(`${folder}/routes.txt`, (r) =>
    routes.set(r.route_id, { short: r.route_short_name, long: r.route_long_name, type: Number(r.route_type) }),
  );
  const trips = new Map();
  await eachRow(`${folder}/trips.txt`, (t) => {
    trips.set(t.trip_id, { routeId: t.route_id, direction: toDirection(agency.direction(t)) });
  });
  const served = new Map(); // stop_id -> { routes: Set, votes: { EASTBOUND: n, … } }
  await eachRow(`${folder}/stop_times.txt`, (st) => {
    const trip = trips.get(st.trip_id);
    if (!trip) return;
    let s = served.get(st.stop_id);
    if (!s) served.set(st.stop_id, (s = { routes: new Set(), votes: {} }));
    s.routes.add(trip.routeId);
    if (trip.direction) s.votes[trip.direction] = (s.votes[trip.direction] ?? 0) + 1;
  });
  const stops = [];
  await eachRow(`${folder}/stops.txt`, (s) => stops.push(s));
  return { routes, served, stops };
}

// ---------- Turning GTFS stops into AccessLoop locations ----------

const a = SERVICE_AREA;
const inArea = (lat, lng) => lat >= a.minLat && lat <= a.maxLat && lng >= a.minLng && lng <= a.maxLng;
const round = (n) => Math.round(n * 1e6) / 1e6;
const byNumber = (x, y) => (parseInt(x, 10) || 9999) - (parseInt(y, 10) || 9999) || x.localeCompare(y);

// The main direction a stop's trips travel, if most of them agree.
function mainDirection(votes) {
  const total = Object.values(votes).reduce((n, v) => n + v, 0);
  const [best, count] = Object.entries(votes).sort((x, y) => y[1] - x[1])[0] ?? [];
  return best && count / total >= 0.6 ? best : null;
}

// A route's number as riders know it: "001" -> "1", "blue" -> "Blue".
const routeNumber = (r) => r.short.replace(/^0+(?=\d)/, '').replace(/^[a-z]/, (c) => c.toUpperCase());

// "29 Dufferin". Also tidies other agencies' styles: "001 HIGHWAY 7" -> "1 Highway 7",
// "900 PULSE 900" -> "900 Pulse", "101 Route 101" -> "101", "blue VIVA BLUE" -> "Viva Blue".
function routeName(r) {
  const number = routeNumber(r);
  let name = r.long.replace(/^route\b/i, '').trim();
  if (!/[a-z]/.test(name)) name = titleCase(name);
  if (number && name.toLowerCase().includes(number.toLowerCase())) {
    if (!/^\d+$/.test(number)) return name;
    name = name.replace(new RegExp(`\\b${number}\\b`), '').trim();
  }
  return `${number} ${name}`.trim();
}

// "29 Dufferin, 929 Dufferin Express" for one or two routes; just the numbers for more.
function routeList(list, prefix = '') {
  const sorted = [...list].sort((x, y) => byNumber(routeNumber(x), routeNumber(y)));
  const text = sorted.length <= 2 ? sorted.map(routeName).join(', ') : sorted.map(routeNumber).join(', ');
  return text ? `${prefix}${text}` : null;
}

// TTC station platforms ("Kennedy Station - Eastbound Platform", "York University - Northbound
// Platform") become one station. Bloor and Yonge are listed separately in the data but are one station.
const STATION_ALIASES = { Bloor: 'Bloor-Yonge', Yonge: 'Bloor-Yonge' };
const ttcStationName = (name) => {
  const base = name
    .replace(/[\s-]*\b(north|south|east|west)bound platform$/i, '')
    .replace(/ Station\b.*$/, '')
    .trim();
  return STATION_ALIASES[base] ?? base;
};

// Subway, LRT and GO train stops are stations; everything else is a bus or streetcar stop.
function stationType(agency, here) {
  if (here.some((r) => r.type === 1)) return 'SUBWAY_STATION';
  if (agency.id === 'TTC' && here.some((r) => r.type === 0 && ['5', '6'].includes(r.short))) return 'LRT_STATION';
  if (here.some((r) => r.type === 2)) return 'GO_STATION';
  return null;
}

const locations = [];
const stations = new Map(); // "agency|name" -> { …location, points: [] }

for (const agency of AGENCIES) {
  if (!args[agency.arg]) continue;
  const { routes, served, stops } = await readAgency(args[agency.arg], agency);
  for (const s of stops) {
    const lat = Number(s.stop_lat);
    const lng = Number(s.stop_lon);
    const info = served.get(s.stop_id);
    if (!info || !inArea(lat, lng)) continue; // skip stops with no service
    const here = [...info.routes].map((id) => routes.get(id)).filter(Boolean);

    const type = stationType(agency, here);
    if (type) {
      // One location per station, built from all its platforms.
      const name = agency.id === 'TTC' ? ttcStationName(s.stop_name) : s.stop_name;
      const key = `${agency.id}|${name}`;
      if (!stations.has(key)) stations.set(key, { name, agency: agency.id, types: new Set(), lines: new Set(), points: [] });
      const st = stations.get(key);
      st.types.add(type);
      st.points.push([lat, lng]);
      for (const r of here) {
        if (r.type === 1 || (type === 'LRT_STATION' && r.type === 0)) st.lines.add(`Line ${r.short}`);
        if (r.type === 2) st.lines.add(r.long);
      }
      continue;
    }

    const streetcar = here.filter((r) => r.type === 0);
    const bus = here.filter((r) => r.type === 3);
    locations.push({
      name: agency.name ? agency.name(s.stop_name) : s.stop_name,
      type: streetcar.length && bus.length ? 'STOP' : streetcar.length ? 'STREETCAR_STOP' : 'BUS_STOP',
      direction: mainDirection(info.votes),
      line: routeList([...streetcar, ...bus], agency.linePrefix),
      agency: agency.id,
      code: s.stop_code || null,
      latitude: round(lat),
      longitude: round(lng),
    });
  }
}

// Each station sits in the middle of its platforms.
for (const st of stations.values()) {
  const type = st.types.has('SUBWAY_STATION') ? 'SUBWAY_STATION' : [...st.types][0];
  const lines = [...st.lines].sort(byNumber);
  locations.push({
    name: st.name,
    type,
    direction: null,
    line: type === 'GO_STATION' ? `GO ${lines.join(' / ')}` : lines.join(' / '),
    agency: st.agency,
    code: null,
    latitude: round(st.points.reduce((n, p) => n + p[0], 0) / st.points.length),
    longitude: round(st.points.reduce((n, p) => n + p[1], 0) / st.points.length),
  });
}

// ---------- Keeping every location unique ----------

// A whole stop's spot is just its type ("Bus stop"), so its label is its name.
for (const l of locations) l.spot = LOCATION_TYPE_LABELS[l.type];

// A stop number belongs to one stop within an agency. Different agencies can reuse a number.
const codes = new Set();
for (const l of locations) {
  if (!l.code) continue;
  if (codes.has(`${l.agency}|${l.code}`)) l.code = null;
  else codes.add(`${l.agency}|${l.code}`);
}

// The database needs name + spot + direction to be unique. Stops that share all three (two bays
// at one terminal, or a TTC and a YRT stop with the same name) are told apart by their stop
// number. If only one of them comes from the first agency, that one keeps its plain label.
const agencyOrder = (l) => AGENCIES.findIndex((ag) => ag.id === l.agency);
const groups = new Map();
for (const l of locations) {
  const key = `${l.name}|${l.spot}|${l.direction}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(l);
}
for (const group of groups.values()) {
  if (group.length < 2) continue;
  group.sort((x, y) => agencyOrder(x) - agencyOrder(y));
  const first = group[0];
  const firstStaysPlain = group.filter((l) => l.agency === first.agency).length === 1;
  for (const l of group) {
    if (l.code && !(firstStaysPlain && l === first)) l.spot = `Stop ${l.code}`;
  }
}

// Anything still repeated (no stop number to tell them apart) is left out after the first.
const seen = new Set();
let dropped = 0;
const result = locations
  .filter((l) => {
    const key = `${l.name}|${l.spot}|${l.direction}`;
    if (seen.has(key)) return !++dropped;
    seen.add(key);
    return true;
  })
  .map(({ name, spot, direction, line, type, agency, code, latitude, longitude }) => ({
    name, spot, direction, line, type, agency, code, latitude, longitude,
  }))
  .sort((x, y) => x.name.localeCompare(y.name) || x.spot.localeCompare(y.spot));

fs.mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
// One stop per line, so a refresh shows exactly which stops changed.
fs.writeFileSync(OUT, `[\n${result.map((l) => JSON.stringify(l)).join(',\n')}\n]\n`);

const count = (key, value) => result.filter((l) => l[key] === value).length.toLocaleString('en-CA');
console.log(`Saved ${result.length.toLocaleString('en-CA')} stations and stops to prisma/data/stops.json`);
console.log(`  ${AGENCIES.filter((ag) => args[ag.arg]).map((ag) => `${ag.id} ${count('agency', ag.id)}`).join(', ')}`);
console.log(
  `  ${count('type', 'SUBWAY_STATION')} subway stations, ${count('type', 'LRT_STATION')} LRT stations, ${count('type', 'GO_STATION')} GO stations,`,
  `${count('type', 'BUS_STOP')} bus stops, ${count('type', 'STREETCAR_STOP')} streetcar stops, ${count('type', 'STOP')} bus and streetcar stops`,
);
if (dropped) console.log(`  ${dropped} repeated stops without a stop number were left out`);
