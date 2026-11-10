// Trip planning. Routes come from Transitous (https://transitous.org), a free,
// community-run public transport trip planner that covers the TTC, GO, UP Express,
// YRT and MiWay. AccessLoop then checks every route against its open barrier reports.
//
// Transitous usage policy (https://transitous.org/api/): non-commercial, open-source apps,
// a User-Agent with a contact, a visible link to its data sources, and light use.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { CLOSED_STATUSES, SERVICE_AREA } from '../lib/rules.js';
import { formatReport } from '../lib/format.js';
import { decodePolyline, distanceM, distanceToLineM } from '../lib/geo.js';

const router = Router();

const TRANSITOUS_URL = process.env.TRANSITOUS_URL || 'https://api.transitous.org';
// House-number addresses come from Photon, a free OpenStreetMap search built for search-as-you-type.
const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io';
const USER_AGENT = `AccessLoop/1.0 (${process.env.APP_CONTACT || 'https://github.com/oviak0311/accessloop'})`;
const SOURCES_URL = 'https://transitous.org/sources/';
const TIMEOUT_MS = 15000;

// Trips are planned in and around Toronto only.
const AREA = SERVICE_AREA; // Toronto and around
const TORONTO = '43.70,-79.40';

// How close a barrier has to be to count as "on your route".
const STOP_RADIUS_M = 200; // a stop where you get on, off or transfer (stations are big)
const PASS_RADIUS_M = 120; // a stop the vehicle passes through
const WALK_RADIUS_M = 60; // the path you walk

const STREET_MODES = ['WALK', 'BIKE', 'CAR', 'RENTAL', 'CAR_PARKING', 'CAR_DROPOFF', 'HGV', 'FLEX'];
const isTransit = (mode) => !STREET_MODES.includes(mode);

const ROLES = {
  BOARD: { label: 'Where you get on', affectsYou: true, rank: 0 },
  TRANSFER: { label: 'Where you transfer', affectsYou: true, rank: 0 },
  ALIGHT: { label: 'Where you get off', affectsYou: true, rank: 0 },
  WALK: { label: 'On your walk', affectsYou: true, rank: 1 },
  PASS: { label: 'At a stop you pass through', affectsYou: false, rank: 2 },
};

const PLACE_TYPES = { STOP: 'Stop or station', ADDRESS: 'Address', PLACE: 'Place' };

// ---------- Helpers ----------

function parsePoint(value, name) {
  const [lat, lng] = String(value ?? '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpError(400, `Choose a ${name} from the list.`);
  }
  if (lat < AREA.minLat || lat > AREA.maxLat || lng < AREA.minLng || lng > AREA.maxLng) {
    throw new HttpError(400, 'AccessLoop plans trips in and around Toronto. Choose a place in that area.');
  }
  return { lat, lng };
}

async function askTransitous(path, params) {
  const url = new URL(path, TRANSITOUS_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const error = new Error(`Transitous answered ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const round = (n) => Math.round(n * 1e5) / 1e5;

function placeOut(place) {
  return {
    name: place.name,
    lat: place.lat,
    lng: place.lon,
    stopCode: place.stopCode ?? null,
    arrival: place.arrival ?? null,
    departure: place.departure ?? null,
  };
}

function legOut(leg) {
  const geometry = leg.legGeometry?.points
    ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6).map(([a, b]) => [round(a), round(b)])
    : [];
  return {
    mode: leg.mode,
    transit: isTransit(leg.mode),
    routeShortName: leg.routeShortName ?? null,
    routeLongName: leg.routeLongName ?? null,
    headsign: leg.headsign ?? null,
    routeColor: leg.routeColor ?? null,
    agencyName: leg.agencyName ?? null,
    from: placeOut(leg.from),
    to: placeOut(leg.to),
    intermediateStops: (leg.intermediateStops ?? []).map(placeOut),
    startTime: leg.startTime,
    endTime: leg.endTime,
    duration: leg.duration,
    distance: leg.distance ?? null,
    realTime: Boolean(leg.realTime),
    wheelchairAccessible: leg.wheelchairAccessible ?? null,
    geometry,
  };
}

// Finds the open barriers on one route and says where each one is on the trip.
function barriersOnRoute(legs, openReports) {
  const transitIndexes = legs.map((l, i) => (l.transit ? i : -1)).filter((i) => i >= 0);
  const firstTransit = transitIndexes[0];
  const lastTransit = transitIndexes.at(-1);
  const found = new Map(); // report id -> { role, legIndex, position, stopName }

  // position: 0 = start of the leg, 1 = along it, 2 = end of it (keeps barriers in trip order)
  const consider = (report, role, legIndex, position, stopName) => {
    const current = found.get(report.id);
    if (!current || ROLES[role].rank < ROLES[current.role].rank) found.set(report.id, { role, legIndex, position, stopName });
  };

  for (const report of openReports) {
    const point = { lat: report.location.latitude, lng: report.location.longitude };
    legs.forEach((leg, i) => {
      if (leg.transit) {
        const near = (place, radius) => distanceM(point, { lat: place.lat, lng: place.lng }) <= radius;
        if (near(leg.from, STOP_RADIUS_M)) consider(report, i === firstTransit ? 'BOARD' : 'TRANSFER', i, 0, leg.from.name);
        if (near(leg.to, STOP_RADIUS_M)) consider(report, i === lastTransit ? 'ALIGHT' : 'TRANSFER', i, 2, leg.to.name);
        for (const stop of leg.intermediateStops) {
          if (near(stop, PASS_RADIUS_M)) consider(report, 'PASS', i, 1, stop.name);
        }
      } else if (distanceToLineM(point, leg.geometry) <= WALK_RADIUS_M) {
        consider(report, 'WALK', i, 1, null);
      }
    });
  }

  return openReports
    .filter((r) => found.has(r.id))
    .map((r) => {
      const { role, legIndex, position, stopName } = found.get(r.id);
      return {
        role,
        roleLabel: ROLES[role].label,
        affectsYou: ROLES[role].affectsYou,
        legIndex,
        position,
        stopName,
        report: formatReport(r),
      };
    })
    .sort((a, b) => a.legIndex - b.legIndex || a.position - b.position);
}

function itineraryOut(itinerary, openReports, { walkOnly = false } = {}) {
  const legs = itinerary.legs.map(legOut);
  return {
    id: itinerary.id ?? `${itinerary.startTime}-${itinerary.duration}`,
    duration: itinerary.duration,
    startTime: itinerary.startTime,
    endTime: itinerary.endTime,
    transfers: itinerary.transfers ?? 0,
    walkOnly,
    legs,
    barriers: barriersOnRoute(legs, openReports),
  };
}

// ---------- Routes ----------

// Addresses with a house number ("123 Main St"). Transitous's search is strongest on stops,
// streets and places, so these come from Photon. If Photon is slow or down, the search carries
// on with Transitous's results alone.
const looksLikeAddress = (q) => /^\d+[a-z]?(-\d+)?\s+\S/i.test(q);
const SHORT_FORMS = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', crescent: 'cres', court: 'ct', place: 'pl', west: 'w', east: 'e', north: 'n', south: 's' };
const placeKey = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => SHORT_FORMS[w] ?? w)
    .join(' ');
const inArea = (p) => p.lat >= AREA.minLat && p.lat <= AREA.maxLat && p.lng >= AREA.minLng && p.lng <= AREA.maxLng;

async function searchAddresses(q) {
  const [lat, lon] = TORONTO.split(',');
  const url = new URL('/api/', PHOTON_URL);
  url.search = new URLSearchParams({
    q,
    lat,
    lon,
    limit: '8',
    lang: 'en',
    bbox: `${AREA.minLng},${AREA.minLat},${AREA.maxLng},${AREA.maxLat}`,
  });
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const { features = [] } = await res.json();
  return features
    .filter((f) => f.properties?.housenumber && f.geometry?.coordinates)
    .map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      return {
        id: `photon-${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lng}`}`,
        name: `${p.housenumber} ${p.street ?? p.name ?? ''}`.trim(),
        type: 'ADDRESS',
        typeLabel: PLACE_TYPES.ADDRESS,
        area: p.city ?? p.district ?? p.county ?? null,
        lat,
        lng,
      };
    })
    .filter(inArea);
}

// READ: places to start or end a trip at: stops, stations, streets, places and addresses.
// ?q= what the rider typed. The text is passed on to Transitous (and Photon for addresses); it isn't saved.
router.get('/places', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  if (q.length > 100) throw new HttpError(400, 'That search is too long.');

  const [fromTransitous, addresses] = await Promise.all([
    askTransitous('/api/v1/geocode', { text: q, place: TORONTO, numResults: 10, language: 'en' }).catch(() => null),
    looksLikeAddress(q) ? searchAddresses(q).catch(() => []) : [],
  ]);
  if (!fromTransitous && !addresses.length) {
    throw new HttpError(502, 'Place search isn’t available right now. Try again in a minute.');
  }

  const places = (fromTransitous ?? [])
    .filter((m) => inArea({ lat: m.lat, lng: m.lon }))
    .map((m) => {
      const area = (m.areas ?? []).find((a) => a.default) ?? (m.areas ?? []).find((a) => a.adminLevel === 8);
      const name = m.type === 'ADDRESS' && m.houseNumber && m.street ? `${m.houseNumber} ${m.street}` : m.name;
      return {
        id: m.id,
        name,
        type: m.type,
        typeLabel: PLACE_TYPES[m.type] ?? 'Place',
        area: area?.name ?? null,
        lat: m.lat,
        lng: m.lon,
      };
    });

  // House-number addresses first when that's what was typed, then everything else, without repeats
  // ("100 Queen Street West" and "100 Queen St W" are the same place).
  const seen = new Set();
  const merged = [...addresses, ...places].filter((p) => {
    const key = `${placeKey(p.name)}|${(p.area ?? '').toLowerCase()}`;
    return seen.has(key) ? false : seen.add(key);
  });
  res.json(merged.slice(0, 8));
});

// READ: routes from one place to another, each checked for open barriers.
// ?from=lat,lng  ?to=lat,lng  ?time=ISO date (optional)  ?arriveBy=true  ?stepFree=false
// Coordinates are passed on to Transitous to plan the trip. AccessLoop doesn't save them.
router.get('/trips', async (req, res) => {
  const from = parsePoint(req.query.from, 'starting point');
  const to = parsePoint(req.query.to, 'destination');
  if (distanceM(from, to) < 30) throw new HttpError(400, 'The start and destination are the same place.');

  let time;
  if (req.query.time) {
    time = new Date(String(req.query.time));
    if (Number.isNaN(time.getTime())) throw new HttpError(400, 'That time isn’t valid.');
  }
  const stepFree = req.query.stepFree !== 'false';

  const params = {
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    time: time?.toISOString(),
    arriveBy: req.query.arriveBy === 'true' ? 'true' : undefined,
    pedestrianProfile: stepFree ? 'WHEELCHAIR' : 'FOOT',
    detailedTransfers: 'true',
    maxItineraries: 5,
    language: 'en',
  };

  let plan;
  try {
    plan = await askTransitous('/api/v6/plan', params);
  } catch (err) {
    // Fall back to the previous API version if this server doesn't have v6 yet.
    if (err.status === 404) {
      try {
        plan = await askTransitous('/api/v5/plan', params);
      } catch {
        plan = null;
      }
    }
    if (!plan) throw new HttpError(502, 'Trip planning isn’t available right now. Try again in a minute.');
  }

  const openReports = await prisma.report.findMany({
    where: { status: { notIn: CLOSED_STATUSES }, location: { latitude: { not: null }, longitude: { not: null } } },
    include: {
      category: true,
      location: true,
      responses: { select: { value: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      history: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const itineraries = [
    ...(plan.itineraries ?? []).map((it) => itineraryOut(it, openReports)),
    ...(plan.direct ?? []).map((it) => itineraryOut(it, openReports, { walkOnly: true })),
  ];

  res.json({
    stepFree,
    itineraries,
    source: { name: 'Transitous', url: 'https://transitous.org', sourcesUrl: SOURCES_URL },
  });
});

export default router;
