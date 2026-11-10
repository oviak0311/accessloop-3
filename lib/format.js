// Turns database rows into the JSON the front end uses.
// Values like the title, "last confirmed" and "may have cleared" are
// worked out here from stored data instead of being saved separately.
import {
  KIND_LABELS,
  STATUS_LABELS,
  RESPONSE_LABELS,
  SEVERITY_LABELS,
  DIRECTION_LABELS,
  LOCATION_TYPE_LABELS,
  RESPONSES_BY_KIND,
  MAY_HAVE_CLEARED_HOURS,
  isClosed,
  responseOptions,
  allowedNextStatuses,
} from './rules.js';

const HOUR = 60 * 60 * 1000;

export function locationLabel(location) {
  const direction = location.direction ? ` (${DIRECTION_LABELS[location.direction]})` : '';
  const showSpot = location.spot !== LOCATION_TYPE_LABELS[location.type];
  return `${location.name}${direction}${showSpot ? `, ${location.spot}` : ''}`;
}

export function formatLocation(location) {
  return {
    id: location.id,
    name: location.name,
    spot: location.spot,
    direction: location.direction,
    directionLabel: location.direction ? DIRECTION_LABELS[location.direction] : null,
    line: location.line,
    type: location.type,
    typeLabel: LOCATION_TYPE_LABELS[location.type],
    label: locationLabel(location),
    code: location.code ?? null,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
  };
}

export function formatCategory(category) {
  return {
    id: category.id,
    name: category.name,
    kind: category.kind,
    kindLabel: KIND_LABELS[category.kind],
    description: category.description,
    responseOptions: responseOptions(category.kind),
  };
}

// Expects report.category, report.location, report.responses (newest first)
// and report.history (at least the newest status change).
function deriveState(report, now) {
  const kind = report.category.kind;
  const { still, gone, riderSays } = RESPONSES_BY_KIND[kind];
  const responses = report.responses ?? [];
  const latestStill = responses.find((r) => r.value === still);
  const latestGone = responses.find((r) => r.value === gone);

  const lastConfirmedAt = latestStill ? latestStill.createdAt : report.createdAt;
  const lastStatusChangeAt = report.history?.length
    ? report.history.reduce((latest, h) => (h.createdAt > latest ? h.createdAt : latest), report.history[0].createdAt)
    : report.createdAt;

  const open = !isClosed(report.status);
  // A "gone" response newer than the last status change flags the report for the admin.
  const flagged = Boolean(open && latestGone && latestGone.createdAt > lastStatusChangeAt);
  const mayHaveCleared =
    open && kind === 'CONDITION' && now - new Date(lastConfirmedAt) > MAY_HAVE_CLEARED_HOURS * HOUR;

  return {
    isOpen: open,
    lastConfirmedAt,
    lastStatusChangeAt,
    flagged,
    riderSays: flagged ? riderSays : null,
    mayHaveCleared,
    responseCounts: {
      [still]: responses.filter((r) => r.value === still).length,
      [gone]: responses.filter((r) => r.value === gone).length,
    },
  };
}

export function formatReport(report, { now = new Date(), forAdmin = false } = {}) {
  const state = deriveState(report, now);
  const formatted = {
    id: report.id,
    title: `${report.category.name} · ${locationLabel(report.location)}`,
    category: formatCategory(report.category),
    location: formatLocation(report.location),
    description: report.description,
    severity: report.severity,
    severityLabel: SEVERITY_LABELS[report.severity],
    status: report.status,
    statusLabel: STATUS_LABELS[report.status],
    isSample: report.isSample,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    resolvedAt: report.resolvedAt,
    duplicateOfId: report.duplicateOfId,
    ...state,
  };
  if (forAdmin) {
    formatted.allowedNextStatuses = allowedNextStatuses(report.category.kind, report.status);
  }
  return formatted;
}

export function formatHistory(history) {
  return history.map((h) => ({
    id: h.id,
    oldStatus: h.oldStatus,
    oldStatusLabel: h.oldStatus ? STATUS_LABELS[h.oldStatus] : null,
    newStatus: h.newStatus,
    newStatusLabel: STATUS_LABELS[h.newStatus],
    note: h.note,
    createdAt: h.createdAt,
  }));
}

export function formatResponses(responses) {
  return responses.map((r) => ({
    id: r.id,
    value: r.value,
    label: RESPONSE_LABELS[r.value],
    createdAt: r.createdAt,
  }));
}
