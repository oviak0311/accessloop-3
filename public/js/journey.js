// Trip planning helpers: labels, route colours, route cards, step lists and drawing routes.
import { esc, icon, barrierIcon, timeAgo } from './ui.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export function minutes(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}
const metres = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

const MODES = {
  BUS: ['bus', 'Bus'],
  COACH: ['bus', 'Coach'],
  TRAM: ['tram', 'Streetcar'],
  SUBWAY: ['station', 'Subway'],
  RAIL: ['station', 'Train'],
  REGIONAL_RAIL: ['station', 'Train'],
  SUBURBAN: ['station', 'Train'],
  FERRY: ['water', 'Ferry'],
};
const modeInfo = (mode) => MODES[mode] ?? ['bus', 'Transit'];

// Line 1 to Line 6 show as "Line 1"; buses and streetcars show their route number.
const isLine = (leg) => leg.mode === 'SUBWAY' || (leg.mode === 'TRAM' && ['5', '6'].includes(leg.routeShortName));
const shortLabel = (leg) => (isLine(leg) && leg.routeShortName ? `Line ${leg.routeShortName}` : leg.routeShortName || modeInfo(leg.mode)[1]);
const longLabel = (leg) =>
  leg.routeLongName ?? (isLine(leg) ? shortLabel(leg) : `${modeInfo(leg.mode)[1]} ${leg.routeShortName ?? ''}`.trim());
const modeName = (leg) => (leg.mode === 'TRAM' && isLine(leg) ? 'LRT' : modeInfo(leg.mode)[1]);

// Route colours come from the transit data. Text is navy or white, whichever is readable;
// if neither reaches 4.5:1 contrast, the colour is darkened until white text does.
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255);
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const NAVY = luminance([20, 33, 61]);
export function routeColours(leg) {
  const hex = /^[0-9a-f]{6}$/i.test(leg.routeColor ?? '') ? leg.routeColor : '1f5fa8';
  const line = `#${hex}`;
  let rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const l = luminance(rgb);
  if (contrast(l, NAVY) >= 4.5 && contrast(l, NAVY) > contrast(l, 1)) return { line, bg: line, fg: '#14213d' };
  while (contrast(luminance(rgb), 1) < 4.5) rgb = rgb.map((c) => c * 0.9);
  return { line, bg: `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`, fg: '#ffffff' };
}

// How a route looks for access: "warning" if a barrier affects you, "unknown" if a vehicle
// may not be accessible, otherwise "clear".
export function accessInfo(it) {
  const affecting = it.barriers.filter((b) => b.affectsYou);
  const passing = it.barriers.length - affecting.length;
  if (affecting.length) {
    const latest = affecting.map((b) => new Date(b.report.lastConfirmedAt)).sort((a, b) => b - a)[0];
    return { tone: 'warning', title: `${plural(affecting.length, 'reported barrier')} on this route`, detail: `Last confirmed ${timeAgo(latest)}` };
  }
  if (it.legs.some((l) => l.transit && l.wheelchairAccessible === false)) {
    return { tone: 'unknown', title: 'A vehicle on this route may not be accessible', detail: 'Check the steps before you go' };
  }
  if (passing) return { tone: 'clear', title: 'No barriers where you get on, off or walk', detail: `${plural(passing, 'barrier')} at stops you pass through` };
  return { tone: 'clear', title: 'No barriers reported on this route', detail: 'Checked against community reports just now' };
}
export const affectingCount = (it) => it.barriers.filter((b) => b.affectsYou).length;

const transfersText = (it) => (it.walkOnly ? 'Walk only' : it.transfers ? plural(it.transfers, 'transfer') : 'No transfers');

export function modeChips(it) {
  return it.legs
    .filter((l) => l.transit || l.duration >= 120 || it.walkOnly)
    .map((leg) => {
      if (!leg.transit) return `<span class="mode-chip mode-chip-walk">${icon('walk', 15)}${minutes(leg.duration)}</span>`;
      const { bg, fg } = routeColours(leg);
      return `<span class="mode-chip" style="background:${bg};color:${fg}">${icon(modeInfo(leg.mode)[0], 15)}${esc(shortLabel(leg))}</span>`;
    })
    .join('<span class="mode-chip-sep" aria-hidden="true">›</span>');
}

export function routeCardHtml(it, index, { selected, fewest }) {
  const access = accessInfo(it);
  return `<li class="route-card route-${access.tone}${selected ? ' is-selected' : ''}">
    <button type="button" data-itinerary="${index}" aria-pressed="${selected}">
      <span class="route-card-top"><strong>${minutes(it.duration)}</strong><span>${transfersText(it)}</span></span>
      <span class="route-times">${clock(it.startTime)} – ${clock(it.endTime)}</span>
      <span class="route-modes">${modeChips(it)}</span>
      <span class="route-access">${icon(access.tone === 'clear' ? 'check' : access.tone === 'warning' ? 'warning' : 'info', 18)}
        <span><strong>${esc(access.title)}</strong><small>${esc(access.detail)}</small></span></span>
      ${fewest ? '<span class="route-badge">Fewest barriers</span>' : ''}
      <span class="view-route">${selected ? 'Showing on map' : 'View route'} ${icon('arrow', 16)}</span>
    </button>
  </li>`;
}

function barrierStep(b) {
  const r = b.report;
  return `<li class="step-with-report${b.affectsYou ? '' : ' is-passing'}">
    ${barrierIcon(r.category, { size: 18 })}
    <div>
      <span class="step-role">${esc(b.roleLabel)}${b.stopName ? ` · ${esc(b.stopName)}` : ''}</span>
      <strong>${esc(r.category.name)}</strong>
      <small>${esc(r.location.label)} · ${esc(r.statusLabel)} · Last confirmed ${timeAgo(r.lastConfirmedAt)}</small>
      <button type="button" data-barrier="${r.id}">View barrier</button>
    </div>
  </li>`;
}

export function routeDetailHtml(it, { from, to }, { stepFree = true } = {}) {
  const access = accessInfo(it);
  const byLeg = new Map();
  for (const b of it.barriers) byLeg.set(b.legIndex, [...(byLeg.get(b.legIndex) ?? []), b]);
  const transitIdx = it.legs.map((l, i) => (l.transit ? i : -1)).filter((i) => i >= 0);
  const last = it.legs.length - 1;

  const steps = it.legs.flatMap((leg, i) => {
    const before = (byLeg.get(i) ?? []).filter((b) => b.position === 0);
    const after = (byLeg.get(i) ?? []).filter((b) => b.position !== 0);
    let step;
    if (!leg.transit) {
      const isTransfer = i > transitIdx[0] && i < transitIdx.at(-1);
      const where = i === last ? 'your destination' : esc(leg.to.name);
      const how = leg.distance ? `${metres(leg.distance)}, ${minutes(leg.duration)}` : minutes(leg.duration);
      step = isTransfer
        ? `<li><span class="step-marker transfer">T</span><div><strong>Transfer at ${esc(leg.from.name)}</strong><small>Walk to ${where} · ${how}</small></div></li>`
        : `<li><span class="step-marker step-walk">${icon('walk', 16)}</span><div><strong>Walk to ${where}</strong><small>${how}</small></div></li>`;
    } else {
      const { bg, fg } = routeColours(leg);
      const stops = leg.intermediateStops.length + 1;
      step = `<li><span class="step-marker" style="background:${bg};color:${fg}">${icon(modeInfo(leg.mode)[0], 16)}</span>
        <div>
          <strong>${esc(modeName(leg))} ${esc(longLabel(leg))}${leg.headsign ? ` toward ${esc(leg.headsign)}` : ''}</strong>
          <small>Get on at ${esc(leg.from.name)} · ${clock(leg.startTime)}${leg.realTime ? ' (live time)' : ''}</small>
          <small>Ride ${plural(stops, 'stop')} · get off at ${esc(leg.to.name)} · ${clock(leg.endTime)}</small>
          ${leg.wheelchairAccessible === false ? '<small class="step-warning">This trip may not be wheelchair accessible</small>' : ''}
          <div class="step-report" role="group" aria-label="Report a barrier on this ride">
            <span aria-hidden="true">Report a barrier at:</span>
            <button type="button" data-stop-leg="${i}" data-stop-end="from" aria-label="Report a barrier at the get-on stop, ${esc(leg.from.name)}">${icon('flag', 15)}Get-on stop</button>
            <button type="button" data-stop-leg="${i}" data-stop-end="to" aria-label="Report a barrier at the get-off stop, ${esc(leg.to.name)}">${icon('flag', 15)}Get-off stop</button>
          </div>
        </div></li>`;
    }
    return [...before.map(barrierStep), step, ...after.map(barrierStep)];
  });

  return `<div class="route-detail">
    <div class="route-detail-summary">
      <div class="selected-route-summary">
        <p class="eyebrow">${stepFree ? 'Your step-free route' : 'Your route'}</p>
        <div><h2 id="route-detail-title" tabindex="-1">${minutes(it.duration)}</h2>${
          it.transfers ? `<span class="route-transfers"><b>${it.transfers}</b> ${it.transfers === 1 ? 'transfer' : 'transfers'}</span>` : `<span>${transfersText(it)}</span>`
        }</div>
        <strong>${clock(it.startTime)} – ${clock(it.endTime)}</strong>
        <p class="route-modes">${modeChips(it)}</p>
        <small>${esc(from.name)} to ${esc(to.name)}</small>
      </div>
      <div class="route-banner route-${access.tone}">
        ${icon(access.tone === 'clear' ? 'check' : access.tone === 'warning' ? 'warning' : 'info')}
        <div><strong>${esc(access.title)}</strong><span>${esc(access.detail)}</span></div>
      </div>
      <p class="route-caution">Routing information can’t guarantee every part of a trip is accessible. Barrier notices come from AccessLoop riders.</p>
      <button type="button" class="secondary-button full-button" data-action="report-route">${icon('plus', 18)}Report a barrier on this route</button>
    </div>
    <ol class="journey-steps" aria-label="Step by step">
      <li><span class="step-marker">A</span><div><strong>Start at ${esc(from.name)}</strong><small>Leave ${clock(it.startTime)}</small></div></li>
      ${steps.join('')}
      <li><span class="step-marker destination">B</span><div><strong>Arrive at ${esc(to.name)}</strong><small>${clock(it.endTime)}</small></div></li>
    </ol>
  </div>`;
}

// Draws every route: alternatives in grey (press one to choose it), the chosen one in its line colours.
export function drawRoutes(layer, itineraries, selected, from, to, { onSelect }) {
  layer.clearLayers();
  const bounds = L.latLngBounds([[from.lat, from.lng], [to.lat, to.lng]]);
  itineraries.forEach((it, index) => {
    if (index === selected) return;
    for (const leg of it.legs) {
      if (!leg.geometry.length) continue;
      bounds.extend(leg.geometry);
      L.polyline(leg.geometry, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false }).addTo(layer);
      const line = L.polyline(leg.geometry, { color: '#8e9dab', weight: 5, opacity: 0.9, className: 'route-alternative' });
      line.on('click', () => onSelect(index));
      line.addTo(layer);
    }
  });
  const it = itineraries[selected];
  if (it) {
    for (const leg of it.legs) {
      if (!leg.geometry.length) continue;
      bounds.extend(leg.geometry);
      if (leg.transit) {
        L.polyline(leg.geometry, { color: '#ffffff', weight: 11, opacity: 0.95, interactive: false }).addTo(layer);
        L.polyline(leg.geometry, { color: routeColours(leg).line, weight: 7, interactive: false }).addTo(layer);
      } else {
        L.polyline(leg.geometry, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false }).addTo(layer);
        L.polyline(leg.geometry, { color: '#1f5fa8', weight: 4, dashArray: '1 9', lineCap: 'round', interactive: false }).addTo(layer);
      }
    }
  }
  const end = (letter, cls) =>
    L.divIcon({ className: 'al-marker', html: `<span class="journey-marker ${cls}">${letter}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
  L.marker([from.lat, from.lng], { icon: end('A', 'journey-start'), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(layer);
  L.marker([to.lat, to.lng], { icon: end('B', 'journey-end'), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(layer);
  return bounds;
}
