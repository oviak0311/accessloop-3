// Public API: anyone can use these routes.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  HttpError,
  parseId,
  parseEnum,
  parseOptionalText,
  requireObjectBody,
  createEditKey,
  hashSecret,
  secretsMatch,
} from '../lib/http.js';
import {
  ALL_STATUSES,
  ALL_SEVERITIES,
  ALL_KINDS,
  CLOSED_STATUSES,
  RESPONSES_BY_KIND,
  RESPONSE_LABELS,
  KIND_LABELS,
  LOCATION_TYPE_LABELS,
  SERVICE_AREA,
  defaultSeverity,
  isClosed,
} from '../lib/rules.js';
import { formatReport, formatCategory, formatLocation, formatHistory, formatResponses } from '../lib/format.js';

const router = Router();

// What every report needs loaded to work out its title, flags and "last confirmed".
const reportInclude = {
  category: true,
  location: true,
  responses: { select: { value: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
  history: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
};

async function getReportDetail(id) {
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      category: true,
      location: true,
      responses: { orderBy: { createdAt: 'desc' } },
      history: { orderBy: { createdAt: 'asc' } },
      duplicateOf: { include: { category: true, location: true } },
      duplicates: { select: { id: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!report) throw new HttpError(404, 'Report not found.');

  // Every report at the same spot, newest first. This is the location's history.
  const atLocation = await prisma.report.findMany({
    where: { locationId: report.locationId },
    select: { id: true, status: true, createdAt: true, resolvedAt: true, category: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Duplicates and unverified reports aren't separate incidents, so they aren't counted.
  const incidents = atLocation.filter((r) => !['DUPLICATE', 'COULD_NOT_VERIFY'].includes(r.status));

  return {
    ...formatReport(report),
    history: formatHistory(report.history),
    responses: formatResponses(report.responses),
    duplicateOf: report.duplicateOf
      ? { id: report.duplicateOf.id, title: formatReport({ ...report.duplicateOf, responses: [], history: [] }).title }
      : null,
    duplicates: report.duplicates,
    locationHistory: {
      reportsLast30Days: incidents.filter((r) => r.createdAt >= thirtyDaysAgo).length,
      totalReports: incidents.length,
      reports: atLocation.map((r) => ({
        id: r.id,
        category: r.category.name,
        status: r.status,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        isThisReport: r.id === report.id,
      })),
    },
  };
}

// ---------- Lists for the report form ----------

router.get('/categories', async (req, res) => {
  const categories = await prisma.category.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
  res.json(categories.map(formatCategory));
});

// Splits "bloor-yonge stn" into ["bloor", "yonge", "stn"]. Every word has to match.
function searchTerms(q) {
  return String(q)
    .trim()
    .split(/[\s\-–—,]+/)
    .filter(Boolean)
    .slice(0, 6);
}

function parseNear(near) {
  const [lat, lng] = String(near).split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'near must be "latitude,longitude".');
  }
  return { lat, lng };
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// READ: stations and stops.
// No filters: every location. With thousands of stops, the front end searches instead:
// ?q=      words in the name, spot or line, or the stop number on the pole
// ?near=   "lat,lng": nearest first, with distanceKm (the position is used for sorting only, never saved)
// ?limit=  up to 50 (default 20) when searching
router.get('/locations', async (req, res) => {
  const { q, near, limit } = req.query;
  if (!q && !near) {
    const locations = await prisma.location.findMany({ orderBy: [{ name: 'asc' }, { spot: 'asc' }] });
    return res.json(locations.map(formatLocation));
  }

  const take = limit ? Math.min(Math.max(parseId(limit, 'limit'), 1), 50) : 20;
  const where = { AND: [] };
  if (q) {
    for (const term of searchTerms(q)) {
      where.AND.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { spot: { contains: term, mode: 'insensitive' } },
          { line: { contains: term, mode: 'insensitive' } },
          { code: term },
        ],
      });
    }
  }

  if (!near) {
    const locations = await prisma.location.findMany({ where, orderBy: [{ name: 'asc' }, { spot: 'asc' }], take });
    return res.json(locations.map(formatLocation));
  }

  // Nearest first. A box of about 20 km keeps the work small before exact distances are worked out.
  const { lat, lng } = parseNear(near);
  where.AND.push({ latitude: { gte: lat - 0.2, lte: lat + 0.2 } }, { longitude: { gte: lng - 0.3, lte: lng + 0.3 } });
  const candidates = await prisma.location.findMany({ where });
  const nearest = candidates
    .map((l) => ({ ...formatLocation(l), distanceKm: distanceKm(lat, lng, l.latitude, l.longitude) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, take);
  res.json(nearest);
});

// READ: one station or stop.
router.get('/locations/:id', async (req, res) => {
  const location = await prisma.location.findUnique({ where: { id: parseId(req.params.id, 'Location ID') } });
  if (!location) throw new HttpError(404, 'Station or stop not found.');
  res.json(formatLocation(location));
});

// ---------- Reports ----------

// READ: browse and filter reports.
// Filters: ?q= &locationId= &categoryId= &kind= &severity= &status=open|closed|STATUS &limit=
router.get('/reports', async (req, res) => {
  const { q, locationId, categoryId, kind, severity, status, limit } = req.query;
  const where = {};

  if (q && String(q).trim()) {
    const text = String(q).trim();
    where.OR = [
      { location: { name: { contains: text, mode: 'insensitive' } } },
      { location: { spot: { contains: text, mode: 'insensitive' } } },
      { location: { line: { contains: text, mode: 'insensitive' } } },
      { category: { name: { contains: text, mode: 'insensitive' } } },
      { description: { contains: text, mode: 'insensitive' } },
    ];
  }
  if (locationId) where.locationId = parseId(locationId, 'locationId');
  if (categoryId) where.categoryId = parseId(categoryId, 'categoryId');
  if (kind) where.category = { kind: parseEnum(kind, ALL_KINDS, 'kind must be equipment, condition or infrastructure.') };
  if (severity) where.severity = parseEnum(severity, ALL_SEVERITIES, 'severity must be low, medium or high.');
  if (status === 'open') where.status = { notIn: CLOSED_STATUSES };
  else if (status === 'closed') where.status = { in: CLOSED_STATUSES };
  else if (status) where.status = parseEnum(status, ALL_STATUSES, 'Unknown status filter.');

  const take = limit ? Math.min(Math.max(parseId(limit, 'limit'), 1), 200) : 100;

  const reports = await prisma.report.findMany({
    where,
    include: reportInclude,
    orderBy: { createdAt: 'desc' },
    take,
  });
  const now = new Date();
  res.json({ count: reports.length, reports: reports.map((r) => formatReport(r, { now })) });
});

// READ: one report with its status timeline, responses and location history.
router.get('/reports/:id', async (req, res) => {
  res.json(await getReportDetail(parseId(req.params.id, 'Report ID')));
});

// A stop chosen from a planned route or the place search, which AccessLoop may not know yet:
// { name, lat, lng, code?, mode? }. If it matches a stop already saved nearby (same stop number,
// or the same name within about 150 m), that one is used; otherwise the stop is added, so its
// history starts here.
const stopKey = (name) => name.toLowerCase().replace(/\bstation\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function findOrAddStop(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Choose a station or stop.');
  const name = parseOptionalText(raw.name, 120, 'Stop name');
  if (!name || name.length < 2) throw new HttpError(400, 'Choose a station or stop.');
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const a = SERVICE_AREA;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < a.minLat || lat > a.maxLat || lng < a.minLng || lng > a.maxLng) {
    throw new HttpError(400, 'That stop is outside the area AccessLoop covers.');
  }
  const code = typeof raw.code === 'string' && /^[\w-]{1,20}$/.test(raw.code) ? raw.code : null;

  const nearby = await prisma.location.findMany({
    where: { latitude: { gte: lat - 0.002, lte: lat + 0.002 }, longitude: { gte: lng - 0.003, lte: lng + 0.003 } },
  });
  const match = nearby
    .map((l) => ({ l, km: distanceKm(lat, lng, l.latitude, l.longitude) }))
    .filter(({ l, km }) => km <= 0.15 && ((code && l.code === code) || stopKey(l.name) === stopKey(name)))
    .sort((x, y) => x.km - y.km)[0];
  if (match && match.l.spot === LOCATION_TYPE_LABELS[match.l.type]) return match.l; // the stop itself

  // A station saved by its parts (an elevator, an entrance) is reported here as the station as a
  // whole, under the name AccessLoop already uses for it.
  const base = match?.l;
  const stopName = base ? base.name : name;
  const type = base ? base.type : /SUBWAY|METRO/.test(String(raw.mode ?? '')) ? 'SUBWAY_STATION' : 'STOP';
  const spot = LOCATION_TYPE_LABELS[type]; // a whole stop, so the label is just its name
  if (base) {
    const whole = await prisma.location.findFirst({ where: { name: stopName, spot, direction: null } });
    if (whole) return whole;
  }
  const codeTaken = code ? await prisma.location.findUnique({ where: { code } }) : null;
  try {
    return await prisma.location.create({
      data: {
        name: stopName,
        spot,
        type,
        line: base?.line ?? null,
        latitude: base ? base.latitude : lat,
        longitude: base ? base.longitude : lng,
        code: code && !codeTaken && !base ? code : null,
      },
    });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    // Another stop already has this name; use it only if it's the same place.
    const same = await prisma.location.findFirst({ where: { name: stopName, spot, direction: null } });
    if (same && distanceKm(lat, lng, same.latitude, same.longitude) <= 1) return same;
    throw new HttpError(409, 'Another stop has that name. Search for it by its stop number instead.');
  }
}

// CREATE: submit a new report. Returns the private edit key once.
// The location is either { locationId } for a saved stop, or { place } for a stop from a planned
// route or the place search. Severity is optional; without it, the barrier type sets it.
router.post('/reports', async (req, res) => {
  const body = requireObjectBody(req.body);

  if (body.categoryId === undefined) throw new HttpError(400, 'Choose a barrier type.');
  if (body.locationId === undefined && body.place === undefined) throw new HttpError(400, 'Choose a station or stop.');
  const categoryId = parseId(body.categoryId, 'categoryId');
  const locationId = body.locationId === undefined ? null : parseId(body.locationId, 'locationId');
  const chosenSeverity =
    body.severity === undefined || body.severity === null ? null : parseEnum(body.severity, ALL_SEVERITIES, 'Severity must be low, medium or high.');
  const description = parseOptionalText(body.description, 1000, 'Description');

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(400, 'That barrier type doesn’t exist.');
  const location = locationId ? await prisma.location.findUnique({ where: { id: locationId } }) : await findOrAddStop(body.place);
  if (!location) throw new HttpError(400, 'That station or stop doesn’t exist.');
  const severity = chosenSeverity ?? defaultSeverity(category);

  const editKey = createEditKey();

  // The report and its first history record are saved together in one write.
  const report = await prisma.report.create({
    data: {
      categoryId,
      locationId: location.id,
      severity,
      description,
      editKeyHash: hashSecret(editKey),
      history: { create: { oldStatus: null, newStatus: 'REPORTED' } },
    },
  });

  res.status(201).json({
    report: await getReportDetail(report.id),
    editKey,
    message: 'Save this edit key. It’s the only way to edit your report, and it won’t be shown again.',
  });
});

// UPDATE: the reporter edits description and severity with their edit key.
router.put('/reports/:id', async (req, res) => {
  const id = parseId(req.params.id, 'Report ID');
  const body = requireObjectBody(req.body);

  if ('categoryId' in body || 'locationId' in body) {
    throw new HttpError(400, 'Barrier type and location can’t be changed. If they’re wrong, submit a new report.');
  }
  if ('status' in body) {
    throw new HttpError(400, 'Only the accessibility team can change a report’s status.');
  }
  if (!('description' in body) && !('severity' in body)) {
    throw new HttpError(400, 'Send a new description or severity.');
  }

  const data = {};
  if ('description' in body) data.description = parseOptionalText(body.description, 1000, 'Description');
  if ('severity' in body) data.severity = parseEnum(body.severity, ALL_SEVERITIES, 'Severity must be low, medium or high.');

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw new HttpError(404, 'Report not found.');

  const editKey = req.get('x-edit-key') ?? body.editKey;
  if (!editKey || !secretsMatch(editKey, report.editKeyHash)) {
    throw new HttpError(403, 'This edit key doesn’t match this report.');
  }
  if (report.status !== 'REPORTED') {
    throw new HttpError(409, 'This report is already being reviewed, so it can no longer be edited.');
  }

  await prisma.report.update({ where: { id }, data });
  res.json(await getReportDetail(id));
});

// CREATE: a rider confirms whether a barrier is still there.
router.post('/reports/:id/responses', async (req, res) => {
  const id = parseId(req.params.id, 'Report ID');
  const body = requireObjectBody(req.body);

  const report = await prisma.report.findUnique({ where: { id }, include: { category: true } });
  if (!report) throw new HttpError(404, 'Report not found.');
  if (isClosed(report.status)) {
    throw new HttpError(409, 'This report is closed, so it can’t take new responses.');
  }

  const { still, gone } = RESPONSES_BY_KIND[report.category.kind];
  const message = `For ${KIND_LABELS[report.category.kind].toLowerCase()}, choose “${RESPONSE_LABELS[still]}” or “${RESPONSE_LABELS[gone]}”.`;
  const value = parseEnum(body.value, [still, gone], message);

  await prisma.response.create({ data: { reportId: id, value } });
  res.status(201).json(await getReportDetail(id));
});

// ---------- Insights ----------

// READ: counts and averages worked out from all stored reports.
router.get('/insights', async (req, res) => {
  const notDuplicate = { status: { not: 'DUPLICATE' } };

  const [total, open, fixed, samples, byCategoryRows, byLocationRows, categories, locations, fixTimes, monthly] =
    await Promise.all([
      prisma.report.count({ where: notDuplicate }),
      prisma.report.count({ where: { status: { notIn: CLOSED_STATUSES } } }),
      prisma.report.count({ where: { resolvedAt: { not: null } } }),
      prisma.report.count({ where: { ...notDuplicate, isSample: true } }),
      prisma.report.groupBy({ by: ['categoryId'], where: notDuplicate, _count: { _all: true } }),
      prisma.report.groupBy({ by: ['locationId'], where: notDuplicate, _count: { _all: true } }),
      prisma.category.findMany(),
      prisma.location.findMany(),
      // Average time from report to fix, by kind. Only Resolved, Cleared and Built count.
      prisma.$queryRaw`
        SELECT c."kind" AS kind,
               COUNT(*)::int AS fixed,
               AVG(EXTRACT(EPOCH FROM (r."resolvedAt" - r."createdAt")) / 3600)::float AS hours
        FROM "reports" r
        JOIN "categories" c ON c."id" = r."categoryId"
        WHERE r."resolvedAt" IS NOT NULL
        GROUP BY c."kind"`,
      // Reports per month for the last 12 months.
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', r."createdAt"), 'YYYY-MM') AS month,
               COUNT(*)::int AS reports
        FROM "reports" r
        WHERE r."status" <> 'DUPLICATE'
          AND r."createdAt" >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY 1
        ORDER BY 1`,
    ]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const byCategory = byCategoryRows
    .map((row) => ({ ...formatCategory(categoryById.get(row.categoryId)), reports: row._count._all }))
    .sort((a, b) => b.reports - a.reports);

  const byKind = ALL_KINDS.map((kind) => ({
    kind,
    kindLabel: KIND_LABELS[kind],
    reports: byCategory.filter((c) => c.kind === kind).reduce((sum, c) => sum + c.reports, 0),
  }));

  // Locations with more than one report are recurring problems.
  const recurringLocations = byLocationRows
    .filter((row) => row._count._all > 1)
    .map((row) => ({ ...formatLocation(locationById.get(row.locationId)), reports: row._count._all }))
    .sort((a, b) => b.reports - a.reports)
    .slice(0, 5);

  const totalFixed = fixTimes.reduce((sum, row) => sum + row.fixed, 0);
  const overallHours = totalFixed
    ? fixTimes.reduce((sum, row) => sum + row.hours * row.fixed, 0) / totalFixed
    : null;
  const round = (n) => (n === null ? null : Math.round(n * 10) / 10);

  // Fill in months with no reports so a chart has every month.
  const counts = new Map(monthly.map((m) => [m.month, m.reports]));
  const months = [];
  const start = new Date();
  start.setUTCDate(1);
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ month: key, reports: counts.get(key) ?? 0 });
  }

  res.json({
    totals: { reports: total, open, fixed, closedWithoutFix: total - open - fixed, sample: samples },
    byKind,
    byCategory,
    recurringLocations,
    averageHoursToFix: {
      overall: round(overallHours),
      byKind: ALL_KINDS.map((kind) => {
        const row = fixTimes.find((r) => r.kind === kind);
        return { kind, kindLabel: KIND_LABELS[kind], fixed: row?.fixed ?? 0, hours: round(row?.hours ?? null) };
      }),
    },
    reportsPerMonth: months,
    generatedAt: new Date(),
  });
});

export default router;
