// Loads sample data for the demo. Every sample report has isSample: true.
// Running the seed again replaces the sample reports but never touches real ones.
// Dates are relative to today, so the demo always looks current.
// Coordinates are approximate and only place the pins on the map.
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();
const daysAgo = (days, hour = 9, minute = 0) => {
  const d = new Date(now - days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const hoursAgo = (hours) => new Date(now - hours * HOUR);
const unusableKeyHash = () => crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');

const categories = [
  { name: 'Elevator out of service', kind: 'EQUIPMENT', description: 'An elevator isn’t working.' },
  { name: 'Escalator out of service', kind: 'EQUIPMENT', description: 'An escalator isn’t working.' },
  { name: 'Automatic door not working', kind: 'EQUIPMENT', description: 'A powered door won’t open with its button.' },
  { name: 'Intercom not working', kind: 'EQUIPMENT', description: 'A help or passenger assistance intercom isn’t working.' },
  { name: 'Ice or snow at stop', kind: 'CONDITION', description: 'Ice or snow blocks the stop or boarding area.' },
  { name: 'Flooding', kind: 'CONDITION', description: 'Water blocks a path, entrance or stop.' },
  { name: 'Construction blocking access', kind: 'CONDITION', description: 'Construction blocks an accessible path or stop.' },
  { name: 'Accessible entrance closed', kind: 'CONDITION', description: 'An accessible entrance is temporarily closed.' },
  { name: 'No shelter', kind: 'INFRASTRUCTURE', description: 'The stop has no shelter.' },
  { name: 'No bench', kind: 'INFRASTRUCTURE', description: 'The stop has nowhere to sit.' },
  { name: 'Poor lighting', kind: 'INFRASTRUCTURE', description: 'The stop or path is poorly lit.' },
];

const locations = [
  { key: 'L1', name: 'Bloor–Yonge', spot: 'North entrance elevator', line: 'Line 1 / Line 2', type: 'SUBWAY_STATION', latitude: 43.67085, longitude: -79.38593 },
  { key: 'L2', name: 'Union', spot: 'Front St accessible door', line: 'Line 1', type: 'SUBWAY_STATION', latitude: 43.64532, longitude: -79.38055 },
  { key: 'L3', name: 'Kennedy', spot: 'Bus platform elevator', line: 'Line 2', type: 'SUBWAY_STATION', latitude: 43.73224, longitude: -79.26371 },
  { key: 'L4', name: 'Finch', spot: 'Escalator to bus terminal', line: 'Line 1', type: 'SUBWAY_STATION', latitude: 43.78071, longitude: -79.41575 },
  { key: 'L5', name: 'Dufferin St at Finch Ave W', spot: 'Bus stop', direction: 'NORTHBOUND', line: '29 Dufferin', type: 'BUS_STOP', latitude: 43.76945, longitude: -79.46622 },
  { key: 'L6', name: 'Queen St W at Spadina Ave', spot: 'Streetcar stop', direction: 'EASTBOUND', line: '501 Queen', type: 'STREETCAR_STOP', latitude: 43.64877, longitude: -79.39595 },
  { key: 'L7', name: 'Lawrence Ave E at Kennedy Rd', spot: 'Bus stop', direction: 'WESTBOUND', line: '54 Lawrence East', type: 'BUS_STOP', latitude: 43.75228, longitude: -79.27966 },
  { key: 'L8', name: 'St George', spot: 'Line 2 platform elevator', line: 'Line 1 / Line 2', type: 'SUBWAY_STATION', latitude: 43.66829, longitude: -79.39977 },
  { key: 'L9', name: 'Bathurst St at Bloor St W', spot: 'Bus stop', direction: 'SOUTHBOUND', line: '7 Bathurst', type: 'BUS_STOP', latitude: 43.66538, longitude: -79.41128 },
  { key: 'L10', name: 'King St W at Spadina Ave', spot: 'Streetcar stop', direction: 'WESTBOUND', line: '504 King', type: 'STREETCAR_STOP', latitude: 43.64561, longitude: -79.39528 },
];

// history: [status, date, note]; responses: [value, date]
const reports = [
  {
    key: 'R1', category: 'Elevator out of service', location: 'L1', severity: 'HIGH',
    description: 'Elevator is dark and the call button doesn’t respond.',
    history: [['REPORTED', daysAgo(28, 8, 10)], ['UNDER_REVIEW', daysAgo(28, 9, 30), 'Confirmed with station staff'],
      ['IN_PROGRESS', daysAgo(28, 13), 'Technician on site'], ['RESOLVED', daysAgo(27, 10, 15), 'Elevator back in service']],
    responses: [['STILL_BROKEN', daysAgo(28, 12)]],
  },
  {
    key: 'R2', category: 'Elevator out of service', location: 'L1', severity: 'HIGH',
    description: 'Doors open and close without moving.',
    history: [['REPORTED', daysAgo(21, 7, 45)], ['IN_PROGRESS', daysAgo(21, 9), 'Technician dispatched'],
      ['RESOLVED', daysAgo(21, 16, 30), 'Door sensor replaced']],
    responses: [],
  },
  {
    key: 'R3', category: 'Elevator out of service', location: 'L1', severity: 'HIGH',
    description: 'Out of service sign on the door.',
    history: [['REPORTED', daysAgo(14, 17, 20)], ['UNDER_REVIEW', daysAgo(13, 9)],
      ['IN_PROGRESS', daysAgo(13, 14), 'Waiting for parts'], ['RESOLVED', daysAgo(11, 12), 'Parts replaced']],
    responses: [['STILL_BROKEN', daysAgo(13, 8)], ['STILL_BROKEN', daysAgo(12, 18)]],
  },
  {
    key: 'R4', category: 'Elevator out of service', location: 'L1', severity: 'HIGH',
    description: null,
    history: [['REPORTED', daysAgo(7, 8, 30)], ['RESOLVED', daysAgo(6, 11), 'Reset by technician']],
    responses: [],
  },
  {
    key: 'R5', category: 'Elevator out of service', location: 'L1', severity: 'HIGH',
    description: 'Stopped between floors this morning. Nobody was inside.',
    history: [['REPORTED', hoursAgo(50)], ['UNDER_REVIEW', hoursAgo(48), 'Confirmed with station staff'],
      ['IN_PROGRESS', hoursAgo(43), 'Technician scheduled']],
    responses: [['STILL_BROKEN', hoursAgo(26)], ['STILL_BROKEN', hoursAgo(4)]],
  },
  {
    key: 'R6', category: 'Escalator out of service', location: 'L4', severity: 'MEDIUM',
    description: 'Escalator up to the bus terminal is stopped.',
    history: [['REPORTED', hoursAgo(72)], ['UNDER_REVIEW', hoursAgo(70), 'Checking with maintenance']],
    responses: [['STILL_BROKEN', hoursAgo(30)], ['FIXED', hoursAgo(5)]], // flagged: "Riders say it's fixed"
  },
  {
    key: 'R7', category: 'Automatic door not working', location: 'L2', severity: 'MEDIUM',
    description: 'Push button does nothing. Had to wait for someone to hold the door.',
    history: [['REPORTED', hoursAgo(30)]],
    responses: [['STILL_BROKEN', hoursAgo(26)], ['STILL_BROKEN', hoursAgo(12)], ['STILL_BROKEN', hoursAgo(3)]],
  },
  {
    key: 'R8', category: 'Automatic door not working', location: 'L2', severity: 'MEDIUM', duplicateOf: 'R7',
    description: 'Door button broken.',
    history: [['REPORTED', hoursAgo(28)], ['DUPLICATE', hoursAgo(20), 'Same door as an earlier report']],
    responses: [],
  },
  {
    key: 'R9', category: 'Intercom not working', location: 'L3', severity: 'HIGH',
    description: 'Intercom next to the elevator has no dial tone.',
    history: [['REPORTED', daysAgo(22, 10)], ['IN_PROGRESS', daysAgo(21, 9)], ['RESOLVED', daysAgo(20, 15), 'Intercom repaired']],
    responses: [],
  },
  {
    key: 'R10', category: 'Construction blocking access', location: 'L6', severity: 'HIGH',
    description: 'Fencing blocks the ramp to the platform.',
    history: [['REPORTED', daysAgo(4, 8)]],
    responses: [], // no response in over 48 hours, so it shows "may have cleared"
  },
  {
    key: 'R11', category: 'Ice or snow at stop', location: 'L5', severity: 'HIGH',
    description: 'Snowbank between the sidewalk and the bus door.',
    history: [['REPORTED', daysAgo(284, 7)], ['CLEARED', daysAgo(281, 14), 'Stop cleared by city crew']],
    responses: [['STILL_PRESENT', daysAgo(283, 8)], ['STILL_PRESENT', daysAgo(282, 17)]],
  },
  {
    key: 'R12', category: 'No shelter', location: 'L7', severity: 'MEDIUM',
    description: 'Long wait with no cover from rain or snow.',
    history: [['REPORTED', daysAgo(47, 12)], ['ACKNOWLEDGED', daysAgo(40, 10), 'Added to the shelter request list']],
    responses: Array.from({ length: 14 }, (_, i) => ['STILL_MISSING', daysAgo(46 - i * 3, 8 + (i % 9))]),
  },
  {
    key: 'R13', category: 'Poor lighting', location: 'L5', severity: 'LOW',
    description: 'Stop is very dark after 6 p.m.',
    history: [['REPORTED', daysAgo(86, 19)], ['ACKNOWLEDGED', daysAgo(80, 10)],
      ['PLANNED', daysAgo(60, 11), 'Lighting upgrade scheduled for spring']],
    responses: Array.from({ length: 6 }, (_, i) => ['STILL_MISSING', daysAgo(84 - i * 10, 18)]),
  },
];

async function main() {
  // Replace old sample reports. Their history and responses are deleted with them.
  const removed = await prisma.report.deleteMany({ where: { isSample: true } });

  const categoryIds = {};
  for (const c of categories) {
    const saved = await prisma.category.upsert({
      where: { name: c.name },
      update: { kind: c.kind, description: c.description },
      create: c,
    });
    categoryIds[c.name] = saved.id;
  }

  const locationIds = {};
  for (const { key, ...l } of locations) {
    const existing = await prisma.location.findFirst({
      where: { name: l.name, spot: l.spot, direction: l.direction ?? null },
    });
    // Existing locations get their map coordinates and line updated.
    const saved = existing
      ? await prisma.location.update({
          where: { id: existing.id },
          data: { line: l.line, type: l.type, latitude: l.latitude, longitude: l.longitude },
        })
      : await prisma.location.create({ data: l });
    locationIds[key] = saved.id;
  }

  const reportIds = {};
  for (const r of reports) {
    const statuses = r.history.map(([status]) => status);
    const finalStatus = statuses[statuses.length - 1];
    const [, createdAt] = r.history[0];
    const [, lastChangeAt] = r.history[r.history.length - 1];
    const fixed = ['RESOLVED', 'CLEARED', 'BUILT'].includes(finalStatus);

    const saved = await prisma.report.create({
      data: {
        categoryId: categoryIds[r.category],
        locationId: locationIds[r.location],
        severity: r.severity,
        description: r.description,
        status: finalStatus,
        isSample: true,
        editKeyHash: unusableKeyHash(),
        createdAt,
        resolvedAt: fixed ? lastChangeAt : null,
        duplicateOfId: r.duplicateOf ? reportIds[r.duplicateOf] : null,
        history: {
          create: r.history.map(([status, date, note], i) => ({
            oldStatus: i === 0 ? null : statuses[i - 1],
            newStatus: status,
            note: note ?? null,
            createdAt: date,
          })),
        },
        responses: { create: r.responses.map(([value, date]) => ({ value, createdAt: date })) },
      },
    });
    reportIds[r.key] = saved.id;
  }

  console.log(
    `Seed complete: ${categories.length} barrier types, ${locations.length} locations, ` +
      `${reports.length} sample reports (replaced ${removed.count}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
