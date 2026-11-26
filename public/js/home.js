// Home: a map-first view of reported barriers. The map fills the screen; a stop search floats
// at the top left, details open on the pin (computers) or in a bottom sheet (phones), and
// + Report opens a quick report without leaving the map.
import { api } from './api.js';
import { TORONTO, createBaseMap, hasCoords, latLng } from './mapbase.js';
import { createPinLayer } from './pins.js';
import { createSheet } from './sheet.js';
import { createCombobox } from './combobox.js';
import { barrierCardHtml, saveResponse } from './barrier-card.js';
import { createQuickReport } from './quick-report.js';
import { createPinCard } from './pin-card.js';
import {
  esc,
  icon,
  barrierIcon,
  placeIcon,
  KIND_COPY,
  KIND_ORDER,
  distanceKm,
  formatKm,
  getParam,
  mountChrome,
  errorMessage,
  sheetLinksHtml,
} from './ui.js';

mountChrome('home');

const AREA = { minLat: 43.4, maxLat: 44.3, minLng: -80.1, maxLng: -78.8 }; // Toronto and around
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => window.innerWidth <= 800;
const inArea = (p) => p.lat >= AREA.minLat && p.lat <= AREA.maxLat && p.lng >= AREA.minLng && p.lng <= AREA.maxLng;

const $ = (id) => document.getElementById(id);
const els = {
  app: document.querySelector('.app-map'),
  planner: $('planner'),
  searchForm: $('stop-search'),
  searchInput: $('stop-input'),
  sidePanel: document.querySelector('.side-panel'),
  locate: $('locate-button'),
  locateLabel: $('locate-label'),
  legend: $('map-legend'),
  status: $('app-status'),
};

const state = {
  view: 'map', // what the bottom panel shows: map (nothing; it's hidden) | barrier | place
  reports: [], // open reports
  barrier: null, // { reports, index, answered, error, opener }
  place: null, // a stop with no open barriers, chosen from the search or a link
  located: null,
};

const announce = (text) => {
  els.status.textContent = '';
  requestAnimationFrame(() => (els.status.textContent = text));
};

// ---------- Map, pins and sheet ----------

const map = createBaseMap('map', { zoomControl: false }).setView(TORONTO, 11);
L.control.zoom({ position: 'topright' }).addTo(map);
let youMarker = null;

const pins = createPinLayer(map, { onPick: (reports, el) => openBarrier(reports, 0, el), labelsClassTarget: els.app });

// On a computer, a barrier's details open in a card on its pin, so the search stays on the left.
const pinCard = createPinCard(map, {
  getAvoid: () => {
    const appRect = els.app.getBoundingClientRect();
    return { topLeft: [els.sidePanel.getBoundingClientRect().right - appRect.left + 20, 20], bottomRight: [20, 20] };
  },
  onOpen: (report) => pins.setActive(report.location.id),
  onClose: () => pins.setActive(state.view === 'barrier' ? state.barrier.reports[state.barrier.index].location.id : null),
  onUpdated: (updated) => (state.reports = state.reports.map((r) => (r.id === updated.id ? updated : r))),
  onReportHere: (location) => quickReport.open({ preset: location }),
});
const sheet = createSheet($('sheet'), { footer: sheetLinksHtml() });

// Room the map should leave for the floating panels when it fits something in view:
// on desktop the column on the left, on phones the search at the top and the sheet below.
function viewPadding() {
  const appRect = els.app.getBoundingClientRect();
  if (!phone()) {
    const panelRect = els.sidePanel.getBoundingClientRect();
    return { paddingTopLeft: [panelRect.right - appRect.left + 40, 40], paddingBottomRight: [80, 40] };
  }
  const searchRect = els.planner.getBoundingClientRect();
  const sheetHeight = parseFloat(getComputedStyle(els.app).getPropertyValue('--sheet-now')) || 0;
  return { paddingTopLeft: [24, searchRect.bottom - appRect.top + 16], paddingBottomRight: [24, sheetHeight + 24] };
}
function showPoint(point, minZoom = 15) {
  const zoom = Math.max(map.getZoom(), minZoom);
  map.fitBounds(L.latLngBounds([point, point]), { ...viewPadding(), maxZoom: zoom, animate: !reduceMotion });
}

// ---------- Loading barriers ----------

async function loadReports() {
  const { reports } = await api('/reports?status=open&limit=200');
  state.reports = reports;
  pins.setReports(reports);
}

async function start() {
  try {
    await loadReports();
    const points = state.reports.filter((r) => hasCoords(r.location)).map((r) => latLng(r.location));
    if (points.length) map.fitBounds(points, { ...viewPadding(), maxZoom: 14, animate: false });
    renderSheet();
  } catch (err) {
    sheet.setTitle('Barriers couldn’t load');
    sheet.setContent(errorMessage('Barriers couldn’t load', err.message));
    sheet.open('half');
  }
  handleLinks();
}

// Links into the map: ?report=1 opens the quick report, ?location=ID opens a station or stop.
function handleLinks() {
  if (getParam('report')) quickReport.open();
  const locationId = Number(getParam('location'));
  if (locationId) api(`/locations/${locationId}`).then(openLocation).catch(() => {});
}

// ---------- Sheet views ----------

function renderSheet() {
  if (state.view === 'map') sheet.hide();
  else if (state.view === 'barrier') renderBarrier();
  else if (state.view === 'place') renderPlace();
}

function setView(view, { open } = {}) {
  state.view = view;
  els.app.dataset.view = view;
  pins.setActive(view === 'barrier' ? state.barrier.reports[state.barrier.index].location.id : null);
  renderSheet();
  if (open) sheet.open(open);
  if (pinCard.isOpen) pins.setActive(pinCard.report.location.id); // keep the card's pin marked
}

function openBarrier(reports, index = 0, opener = null) {
  if (!phone()) {
    // Opened from the search, the stop may be inside a numbered bubble: zoom to its pin.
    const l = reports[index].location;
    if (pins.isClustered(l.id)) map.setView(latLng(l), pins.SPREAD_ZOOM, { animate: false });
    return pinCard.open(reports, index, { opener });
  }
  state.barrier = { reports, index, opener };
  setView('barrier', { open: 'half' });
  showPoint(latLng(reports[index].location));
  $('barrier-view-title')?.focus({ preventScroll: true });
}

const closeButton = () => `<button type="button" class="back-link sheet-back" data-action="back">${icon('close')}Close</button>`;

function renderBarrier() {
  const b = state.barrier;
  const report = b.reports[b.index];
  sheet.setTitle(report.category.name);
  sheet.setContent(`${closeButton()}${barrierCardHtml(b)}`);
}

// A station or stop from the search or a link: its barriers if it has open ones, otherwise
// a short "nothing reported" card with a button to report one.
function openLocation(location) {
  const place = pins.places().get(location.id);
  if (place) return openBarrier(place.reports, 0);
  if (pinCard.isOpen) pinCard.close();
  state.place = location;
  setView('place', { open: 'half' });
  if (hasCoords(location)) showPoint(latLng(location));
}

function renderPlace() {
  const l = state.place;
  sheet.setTitle(l.label);
  sheet.setContent(`${closeButton()}
    <div class="place-view">
      <div class="pin-card-title">${placeIcon(l)}<div><p>No open barriers</p><h2 tabindex="-1">${esc(l.label)}</h2></div></div>
      <p class="pin-empty">Nothing is reported here right now. See a barrier? Let other riders know.</p>
      <button type="button" class="button" data-action="report-here" data-location="${l.id}">${icon('plus', 18)}Report a barrier here</button>
    </div>`);
}

// ---------- Stop search (floating card) ----------
// Searches the stations and stops saved in AccessLoop's database.

createCombobox({
  input: els.searchInput,
  list: $('stop-results'),
  idPrefix: 'stop',
  search: (q) => api(`/locations?q=${encodeURIComponent(q)}&limit=8`),
  renderItem: (l) => `<span>${icon(l.type === 'SUBWAY_STATION' ? 'station' : 'location', 18)}</span>
    <span><strong>${esc(l.label)}</strong><small>${esc(l.typeLabel ?? 'Stop')}${l.code ? ` · Stop ${esc(l.code)}` : ''}</small></span>`,
  emptyText: 'No matching stations or stops',
  onChoose: (l) => {
    els.searchInput.value = l.label;
    openLocation(l);
  },
});
els.searchForm.addEventListener('submit', (e) => e.preventDefault());

// ---------- Quick report ----------

const quickReport = createQuickReport({
  root: $('quick-report'),
  button: $('report-button'),
  onSubmitted: () => loadReports().catch(() => {}),
});

// The header's "Report a barrier" opens the quick menu here instead of leaving the map.
document.querySelector('.site-header').addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="index.html?report"]');
  if (!link) return;
  e.preventDefault();
  quickReport.open();
});

// ---------- Events ----------

$('sheet').addEventListener('click', async (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  const b = state.barrier;
  if (button.dataset.action === 'back') {
    setView('map');
    if (b?.opener?.isConnected) b.opener.focus({ preventScroll: true }); // back to the pin
  } else if (button.dataset.step) {
    b.index += Number(button.dataset.step);
    b.error = null;
    renderBarrier();
    pins.setActive(b.reports[b.index].location.id);
    $('barrier-view-title')?.focus();
  } else if (button.dataset.response) {
    const report = b.reports[b.index];
    button.closest('.pin-responses')?.querySelectorAll('button').forEach((x) => (x.disabled = true));
    try {
      const updated = await saveResponse(report, button.dataset.response);
      b.reports[b.index] = updated;
      state.reports = state.reports.map((r) => (r.id === updated.id ? updated : r));
      b.answered = report.id;
      b.error = null;
      announce('Thanks. Your update was added.');
    } catch (err) {
      b.error = err.message;
    }
    renderBarrier();
  } else if (button.dataset.action === 'report-here') {
    const id = Number(button.dataset.location);
    const location = b?.reports.find((r) => r.location.id === id)?.location ?? state.place;
    quickReport.open({ preset: location });
  }
});

// Locate me: the closest open barrier is worked out in the browser; the position isn't sent anywhere.
els.locate.addEventListener('click', () => {
  if (!('geolocation' in navigator)) return announce('Location isn’t available in this browser.');
  els.locateLabel.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const you = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      els.locateLabel.textContent = 'Locate me';
      if (!inArea({ lat: you.latitude, lng: you.longitude })) return announce('You’re outside the area AccessLoop covers.');
      state.located = you;
      if (!youMarker) {
        youMarker = L.marker(latLng(you), {
          icon: L.divIcon({ className: 'al-marker', html: '<span class="you-dot"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1000,
        }).addTo(map);
      } else youMarker.setLatLng(latLng(you));
      showPoint(latLng(you), 15);
      const closest = [...pins.places().values()]
        .map((p) => ({ report: p.reports[0], km: distanceKm(you, p.location) }))
        .sort((a, b) => a.km - b.km)[0];
      announce(closest ? `Closest barrier: ${closest.report.category.name}, ${formatKm(closest.km)} away.` : 'No open barriers reported.');
    },
    () => {
      els.locateLabel.textContent = 'Locate me';
      announce('Location is off. Search for a station or stop instead.');
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
  );
});

els.legend.innerHTML = KIND_ORDER.map((kind) => {
  const example = { EQUIPMENT: 'Elevator', CONDITION: 'Construction', INFRASTRUCTURE: 'No shelter' }[kind];
  return `<span>${barrierIcon({ name: example, kind }, { size: 15 })}${KIND_COPY[kind].short}</span>`;
}).join('');

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) start();
});

start();
