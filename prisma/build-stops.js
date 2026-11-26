// Builds prisma/data/stops.json, the list of every TTC and GO station and stop that
// `npm run db:import-stops` adds to the database.
//
// It reads the agencies' open schedule data (GTFS): stops.txt for names and positions, and
// routes.txt, trips.txt and stop_times.txt to work out which lines serve each stop and which
// way they travel. Run it again with newer files to refresh the list:
//
//   node prisma/build-stops.js --ttc path/to/ttc-gtfs --go path/to/go-gtfs
//
// Sources: TTC schedule data from City of Toronto Open Data; GO Transit schedule data from Metrolinx.
import fs from 'node:fs';
import readline from 'node:readline';
import { LOCATION_TYPE_LABELS, SERVICE_AREA } from '../lib/rules.js';

const args = {}; // --ttc <folder> --go <folder>
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.ttc || !args.go) {
  console.error('Usage: node prisma/build-stops.js --ttc <TTC GTFS folder> --go <GO GTFS folder>');
  process.exit(1);
}
const OUT = new URL('./data/stops.json', import.meta.url);

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

const DIRECTIONS = { north: 'NORTHBOUND', south: 'SOUTHBOUND', east: 'EASTBOUND', west: 'WESTBOUND' };

// For one agency: each stop, the routes that serve it, and the directions its trips are heading.
async function readAgency(folder) {
  const routes = new Map();
  await eachRow(`${folder}/routes.txt`, (r) =>
    routes.set(r.route_id, { short: r.route_short_name, long: r.route_long_name, type: Number(r.route_type) }),
  );
  const trips = new Map();
  await eachRow(`${folder}/trips.txt`, (t) => {
    // TTC headsigns start with the direction: "East - 10 Van Horne towards Victoria Park".
    const word = (t.trip_headsign || '').split(/[\s-]/)[0].toLowerCase();
    trips.set(t.trip_id, { routeId: t.route_id, direction: DIRECTIONS[word] ?? null });
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

// "29 Dufferin, 929 Dufferin Express" for one or two routes; just the numbers for more.
function routeList(list, prefix = '') {
  const sorted = [...list].sort((x, y) => byNumber(x.short, y.short));
  const text = sorted.length <= 2 ? sorted.map((r) => `${r.short} ${r.long}`.trim()).join(', ') : sorted.map((r) => r.short).join(', ');
  return text ? `${prefix}${text}` : null;
}

// TTC station platforms ("Kennedy Station - Eastbound Platform", "York University - Northbound
// Platform") become one station. Bloor and Yonge are listed separately in the data but are one station.
const STATION_ALIASES = { Bloor: 'Bloor-Yonge', Yonge: 'Bloor-Yonge' };
const stationName = (name) => {
  const base = name
    .replace(/[\s-]*\b(north|south|east|west)bound platform$/i, '')
    .replace(/ Station\b.*$/, '')
    .trim();
  return STATION_ALIASES[base] ?? base;
};

const locations = [];
const stations = new Map(); // "agency|name" -> { …location, points: [] }

function addStation(key, data, lat, lng, lines) {
  let st = stations.get(key);
  if (!st) stations.set(key, (st = { ...data, points: [], lines: new Set(), types: new Set() }));
  st.points.push([lat, lng]);
  lines.forEach((l) => st.lines.add(l));
  st.types.add(data.type);
}

// TTC
{
  const { routes, served, stops } = await readAgency(args.ttc);
  for (const s of stops) {
    const lat = Number(s.stop_lat);
    const lng = Number(s.stop_lon);
    const info = served.get(s.stop_id);
    if (!info || !inArea(lat, lng)) continue; // skip stops with no service
    const here = [...info.routes].map((id) => routes.get(id)).filter(Boolean);
    const subway = here.filter((r) => r.type === 1);
    const lrt = here.filter((r) => r.type === 0 && ['5', '6'].includes(r.short));
    if (subway.length || lrt.length) {
      const name = stationName(s.stop_name);
      addStation(`ttc|${name}`, { name, type: subway.length ? 'SUBWAY_STATION' : 'LRT_STATION' }, lat, lng, [...subway, ...lrt].map((r) => `Line ${r.short}`));
      continue;
    }
    const streetcar = here.filter((r) => r.type === 0);
    const bus = here.filter((r) => r.type === 3);
    const type = streetcar.length && bus.length ? 'STOP' : streetcar.length ? 'STREETCAR_STOP' : 'BUS_STOP';
    locations.push({
      name: s.stop_name,
      type,
      direction: mainDirection(info.votes),
      line: routeList([...streetcar, ...bus]),
      code: s.stop_code || null,
      latitude: round(lat),
      longitude: round(lng),
    });
  }
}

// GO Transit
{
  const { routes, served, stops } = await readAgency(args.go);
  for (const s of stops) {
    const lat = Number(s.stop_lat);
    const lng = Number(s.stop_lon);
    const info = served.get(s.stop_id);
    if (!info || !inArea(lat, lng)) continue;
    const here = [...info.routes].map((id) => routes.get(id)).filter(Boolean);
    const rail = here.filter((r) => r.type === 2);
    if (rail.length) {
      addStation(`go|${s.stop_name}`, { name: s.stop_name, type: 'GO_STATION' }, lat, lng, rail.map((r) => r.long));
      continue;
    }
    locations.push({
      name: s.stop_name,
      type: 'BUS_STOP',
      direction: null,
      line: routeList(here.filter((r) => r.type === 3), 'GO bus '),
      code: s.stop_code || null,
      latitude: round(lat),
      longitude: round(lng),
    });
  }
}

// One location per station, in the middle of its platforms.
for (const st of stations.values()) {
  const type = st.types.has('SUBWAY_STATION') ? 'SUBWAY_STATION' : [...st.types][0];
  const lines = [...st.lines].sort(byNumber);
  locations.push({
    name: st.name,
    type,
    direction: null,
    line: type === 'GO_STATION' ? `GO ${lines.join(' / ')}` : lines.join(' / '),
    code: null,
    latitude: round(st.points.reduce((n, p) => n + p[0], 0) / st.points.length),
    longitude: round(st.points.reduce((n, p) => n + p[1], 0) / st.points.length),
  });
}

// ---------- Keeping every location unique ----------

// A whole stop's spot is just its type ("Bus stop"), so its label is its name.
for (const l of locations) l.spot = LOCATION_TYPE_LABELS[l.type];

// A stop number belongs to one stop: if TTC and GO use the same number, the TTC stop keeps it.
const codes = new Set();
for (const l of locations) {
  if (!l.code) continue;
  if (codes.has(l.code)) l.code = null;
  else codes.add(l.code);
}

// The database needs name + spot + direction to be unique. Stops that still share all three
// (two bays at one terminal, for example) are told apart by their stop number.
const groups = new Map();
for (const l of locations) {
  const key = `${l.name}|${l.spot}|${l.direction}`;
  groups.set(key, [...(groups.get(key) ?? []), l]);
}
let dropped = 0;
for (const group of groups.values()) {
  if (group.length < 2) continue;
  for (const l of group) {
    if (l.code) l.spot = `Stop ${l.code}`;
  }
  // Without a stop number to tell them apart, only the first is kept.
  const unnamed = group.filter((l) => !l.code);
  unnamed.slice(1).forEach((l) => (l.drop = true));
  dropped += Math.max(0, unnamed.length - 1);
}

const result = locations
  .filter((l) => !l.drop)
  .map(({ name, spot, direction, line, type, code, latitude, longitude }) => ({ name, spot, direction, line, type, code, latitude, longitude }))
  .sort((x, y) => x.name.localeCompare(y.name) || x.spot.localeCompare(y.spot));

fs.mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
// One stop per line, so a refresh shows exactly which stops changed.
fs.writeFileSync(OUT, `[\n${result.map((l) => JSON.stringify(l)).join(',\n')}\n]\n`);
const count = (t) => result.filter((l) => l.type === t).length;
console.log(`Saved ${result.length} stations and stops to prisma/data/stops.json`);
console.log(
  `  ${count('SUBWAY_STATION')} subway stations, ${count('LRT_STATION')} LRT stations, ${count('GO_STATION')} GO stations,`,
  `${count('BUS_STOP')} bus stops, ${count('STREETCAR_STOP')} streetcar stops, ${count('STOP')} bus and streetcar stops`,
);
if (dropped) console.log(`  ${dropped} repeated stops without a stop number were left out`);
