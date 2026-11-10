// AccessLoop business rules.
// The API enforces these, so they hold no matter what the front end shows.

export const KIND_LABELS = {
  EQUIPMENT: 'Broken equipment',
  CONDITION: 'Temporary condition',
  INFRASTRUCTURE: 'Missing infrastructure',
};

export const STATUS_LABELS = {
  REPORTED: 'Reported',
  UNDER_REVIEW: 'Under review',
  IN_PROGRESS: 'In progress',
  ACKNOWLEDGED: 'Acknowledged',
  PLANNED: 'Planned',
  RESOLVED: 'Resolved',
  CLEARED: 'Cleared',
  BUILT: 'Built',
  NOT_PLANNED: 'Not planned',
  DUPLICATE: 'Duplicate',
  COULD_NOT_VERIFY: 'Couldn’t verify',
};

export const RESPONSE_LABELS = {
  STILL_BROKEN: 'Still broken',
  FIXED: 'Fixed',
  STILL_PRESENT: 'Still present',
  CLEARED: 'Cleared',
  STILL_MISSING: 'Still missing',
  NOW_INSTALLED: 'Now installed',
};

export const SEVERITY_LABELS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

export const DIRECTION_LABELS = {
  NORTHBOUND: 'Northbound',
  SOUTHBOUND: 'Southbound',
  EASTBOUND: 'Eastbound',
  WESTBOUND: 'Westbound',
};

export const LOCATION_TYPE_LABELS = {
  SUBWAY_STATION: 'Subway station',
  BUS_STOP: 'Bus stop',
  STREETCAR_STOP: 'Streetcar stop',
  STOP: 'Bus or streetcar stop',
};

export const ALL_STATUSES = Object.keys(STATUS_LABELS);
export const ALL_SEVERITIES = Object.keys(SEVERITY_LABELS);

// A starting severity for each barrier type, used when a report doesn't choose one (the quick
// report pop-up). Reporters can change it with their edit key, and the full form still asks.
const DEFAULT_SEVERITY = {
  'Elevator out of service': 'HIGH', // no step-free way through
  'Accessible entrance closed': 'HIGH',
  'Construction blocking access': 'HIGH',
  'Escalator out of service': 'MEDIUM',
  'Automatic door not working': 'MEDIUM',
  'Intercom not working': 'MEDIUM',
  Flooding: 'MEDIUM',
  'Ice or snow at stop': 'MEDIUM',
  'No bench': 'LOW',
  'No shelter': 'LOW',
  'Poor lighting': 'LOW',
};
export const defaultSeverity = (category) => DEFAULT_SEVERITY[category.name] ?? (category.kind === 'INFRASTRUCTURE' ? 'LOW' : 'MEDIUM');

// The area AccessLoop covers (Toronto and around), shared with the trip planner.
export const SERVICE_AREA = { minLat: 43.4, maxLat: 44.3, minLng: -80.1, maxLng: -78.8 };
export const ALL_KINDS = Object.keys(KIND_LABELS);

// Rule: each kind has its own path. Statuses only move forward,
// and the admin can skip steps. Built and Not planned are both final steps.
const STATUS_RANK = {
  EQUIPMENT: { REPORTED: 0, UNDER_REVIEW: 1, IN_PROGRESS: 2, RESOLVED: 3 },
  CONDITION: { REPORTED: 0, CLEARED: 1 },
  INFRASTRUCTURE: { REPORTED: 0, ACKNOWLEDGED: 1, PLANNED: 2, BUILT: 3, NOT_PLANNED: 3 },
};

// Rule: these two can close a report of any kind, from any open status.
export const ANY_KIND_CLOSING = ['DUPLICATE', 'COULD_NOT_VERIFY'];

// Rule: these statuses close a report. A closed report can't get
// any more status changes or rider responses.
export const CLOSED_STATUSES = ['RESOLVED', 'CLEARED', 'BUILT', 'NOT_PLANNED', 'DUPLICATE', 'COULD_NOT_VERIFY'];

// Rule: only these count as fixed, so only these set resolvedAt.
export const FIXED_STATUSES = ['RESOLVED', 'CLEARED', 'BUILT'];

// Rule: these need a note so riders can see why.
export const NOTE_REQUIRED = ['NOT_PLANNED', 'COULD_NOT_VERIFY'];

// Rule: each kind has its own pair of rider responses.
export const RESPONSES_BY_KIND = {
  EQUIPMENT: { still: 'STILL_BROKEN', gone: 'FIXED', riderSays: 'Riders say it’s fixed' },
  CONDITION: { still: 'STILL_PRESENT', gone: 'CLEARED', riderSays: 'Riders say it’s cleared' },
  INFRASTRUCTURE: { still: 'STILL_MISSING', gone: 'NOW_INSTALLED', riderSays: 'Riders say it’s now installed' },
};

// Rule: a temporary condition with no "Still present" for this long may have cleared.
export const MAY_HAVE_CLEARED_HOURS = 48;

export function isClosed(status) {
  return CLOSED_STATUSES.includes(status);
}

// Returns an error message if the change isn't allowed, or null if it is.
export function checkTransition(kind, from, to) {
  if (isClosed(from)) {
    return `This report is ${STATUS_LABELS[from].toLowerCase()}, so its status can’t change.`;
  }
  if (from === to) {
    return `This report is already “${STATUS_LABELS[to]}”.`;
  }
  if (ANY_KIND_CLOSING.includes(to)) {
    return null;
  }
  const ranks = STATUS_RANK[kind];
  if (!(to in ranks)) {
    return `“${STATUS_LABELS[to]}” isn’t a status for ${KIND_LABELS[kind].toLowerCase()} reports.`;
  }
  if (ranks[to] <= ranks[from]) {
    return 'Statuses can only move forward.';
  }
  return null;
}

// The statuses the admin can choose next, for building the admin form.
export function allowedNextStatuses(kind, current) {
  if (isClosed(current)) return [];
  const forward = Object.keys(STATUS_RANK[kind]).filter((s) => checkTransition(kind, current, s) === null);
  return [...forward, ...ANY_KIND_CLOSING].map((value) => ({ value, label: STATUS_LABELS[value] }));
}

export function responseOptions(kind) {
  const { still, gone } = RESPONSES_BY_KIND[kind];
  return [still, gone].map((value) => ({ value, label: RESPONSE_LABELS[value] }));
}
