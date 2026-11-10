// Home: a map-first trip planner. The map fills the screen; search and planning float at
// the top left, results and details open in a bottom sheet, and + Report opens a quick menu.
import { api } from './api.js';
import { TORONTO, createBaseMap, hasCoords, latLng } from './mapbase.js';
import { createPinLayer } from './pins.js';
import { createSheet } from './sheet.js';
import { createCombobox } from './combobox.js';
import { barrierCardHtml, saveResponse } from './barrier-card.js';
import { createQuickReport, routeStop } from './quick-report.js';
import { createPinCard } from './pin-card.js';
import {
  routeCardHtml,
  routeDetailHtml,
  drawRoutes,
  affectingCount,
  minutes,
  plural,
} from './journey.js';
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
  form: $('trip-planner'),
  clearTrip: document.querySelector('[data-action="close-planner"]'),
  sidePanel: document.querySelector('.side-panel'),
  fromInput: $('from-input'),
  toInput: $('to-input'),
  stepFree: $('step-free'),
  when: $('when'),
  whenTime: $('when-time'),
  plannerError: $('planner-error'),
  summary: $('planner-summary'),
  locate: $('locate-button'),
  locateLabel: $('locate-label'),
  legend: $('map-legend'),
  status: $('app-status'),
};

const state = {
  mode: 'planning', // planning (the form) | results | route (the form shrinks to a summary)
  view: 'map', // what the bottom panel shows: map (nothing; it's hidden) | barrier | place | results | route
  reports: [], // open reports
  barrier: null, // { reports, index, answered, error, back }
  place: null, // a stop with no open barriers, chosen from a link
  places: { from: null, to: null }, // { name, lat, lng }
  plan: null, // response from /api/trips
  selected: 0,
  located: null,
};

const announce = (text) => {
  els.status.textContent = '';
  requestAnimationFrame(() => (els.status.textContent = text));
};

// ---------- Map, pins and sheet ----------

const map = createBaseMap('map', { zoomControl: false }).setView(TORONTO, 11);
L.control.zoom({ position: 'topright' }).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let youMarker = null;

const pins = createPinLayer(map, { onPick: (reports, el) => openBarrier(reports, 0, el), labelsClassTarget: els.app });

// On a computer, a barrier's details open in a card on its pin, so the planner and your
// routes stay where they are on the left.
const pinCard = createPinCard(map, {
  getAvoid: () => {
    const appRect = els.app.getBoundingClientRect();
    return { topLeft: [els.sidePanel.getBoundingClientRect().right - appRect.left + 20, 20], bottomRight: [20, 20] };
  },
  onOpen: (report) => pins.setActive(report.location.id),
  onClose: () => pins.setActive(state.view === 'barrier' ? state.barrier.reports[state.barrier.index].location.id : null),
  onUpdated: (updated) => (state.reports = state.reports.map((r) => (r.id === updated.id ? updated : r))),
  onReportHere: (location) => quickReport.open({ preset: location }),
  onPlanHere: (location) => planTo(location),
});
const sheet = createSheet($('sheet'), { footer: sheetLinksHtml() });

// Room the map should leave for the floating panels when it fits something in view:
// on desktop the column on the left, on phones the planner at the top and the sheet below.
function viewPadding() {
  const appRect = els.app.getBoundingClientRect();
  if (!phone()) {
    const panelRect = els.sidePanel.getBoundingClientRect();
    return { paddingTopLeft: [panelRect.right - appRect.left + 40, 40], paddingBottomRight: [80, 40] };
  }
  const plannerRect = els.planner.getBoundingClientRect();
  const sheetHeight = parseFloat(getComputedStyle(els.app).getPropertyValue('--sheet-now')) || 0;
  return { paddingTopLeft: [24, plannerRect.bottom - appRect.top + 16], paddingBottomRight: [24, sheetHeight + 24] };
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

// Links into the map: ?report=1, ?location=ID, ?to=lat,lng&toName=… (and from/fromName)
function handleLinks() {
  if (getParam('report')) quickReport.open();
  const locationId = Number(getParam('location'));
  if (locationId) api(`/locations/${locationId}`).then(openLocation).catch(() => {});
  for (const key of ['from', 'to']) {
    const point = getParam(key);
    const name = getParam(`${key}Name`);
    if (!point || !name) continue;
    const [lat, lng] = point.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setPlace(key, { name, lat, lng });
  }
  if (state.places.to) {
    openPlanner();
    if (state.places.from) planTrip();
    else useMyLocationAsStart({ quiet: true });
  }
}

// ---------- Sheet views ----------

function renderSheet() {
  if (state.view === 'map') sheet.hide();
  else if (state.view === 'barrier') renderBarrier();
  else if (state.view === 'place') renderPlace();
  else if (state.view === 'results') renderResults();
  else if (state.view === 'route') renderRoute();
}

function setView(view, { open } = {}) {
  state.view = view;
  els.app.dataset.view = view;
  pins.setActive(view === 'barrier' ? state.barrier.reports[state.barrier.index].location.id : null);
  const route = state.plan?.itineraries[state.selected];
  pins.setHighlighted(view === 'route' || (view === 'barrier' && state.barrier?.back === 'route') ? route.barriers.map((b) => b.report.location.id) : null);
  renderSheet();
  if (open) sheet.open(open);
  if (pinCard.isOpen) pins.setActive(pinCard.report.location.id); // keep the card's pin marked
}

function openBarrier(reports, index = 0, opener = null) {
  if (!phone()) {
    // Opened from a list or a route step, the stop may be inside a numbered bubble: zoom to its pin.
    const l = reports[index].location;
    if (pins.isClustered(l.id)) map.setView(latLng(l), pins.SPREAD_ZOOM, { animate: false });
    return pinCard.open(reports, index, { opener });
  }
  const back = state.view === 'barrier' ? state.barrier.back : state.view;
  state.barrier = { reports, index, back, opener };
  setView('barrier', { open: 'half' });
  showPoint(latLng(reports[index].location));
  $('barrier-view-title')?.focus({ preventScroll: true });
}

function renderBarrier() {
  const b = state.barrier;
  const report = b.reports[b.index];
  sheet.setTitle(report.category.name);
  sheet.setContent(`${backButton(b.back)}${barrierCardHtml(b)}`);
}

// Opened from the map, the panel just closes; opened from a route, it goes back to it.
function backButton(back) {
  const label = { results: 'Route options', route: 'Your route' }[back];
  return label
    ? `<button type="button" class="back-link sheet-back" data-action="back">${icon('back')}${label}</button>`
    : `<button type="button" class="back-link sheet-back" data-action="back">${icon('close')}Close</button>`;
}

function openLocation(location) {
  const place = pins.places().get(location.id);
  if (place) return openBarrier(place.reports, 0);
  state.place = location;
  setView('place', { open: 'half' });
  if (hasCoords(location)) showPoint(latLng(location));
}

function renderPlace() {
  const l = state.place;
  sheet.setTitle(l.label);
  sheet.setContent(`${backButton('map')}
    <div class="place-view">
      <div class="pin-card-title">${placeIcon(l)}<div><p>No open barriers</p><h2 tabindex="-1">${esc(l.label)}</h2></div></div>
      <p class="pin-empty">Nothing is reported here right now. See a barrier? Let other riders know.</p>
      <button type="button" class="button" data-action="report-here" data-location="${l.id}">${icon('plus', 18)}Report a barrier here</button>
    </div>`);
}

function queryLine() {
  const when = els.when.value === 'now' ? 'Leave now' : `${els.when.value === 'arrive' ? 'Arrive by' : 'Leave at'} ${new Date(els.whenTime.value).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
  return `${when} · ${state.plan.stepFree ? 'Step-free' : 'Any route'}`;
}

function renderResults() {
  const { itineraries } = state.plan;
  const { from, to } = state.places;
  sheet.setTitle(itineraries.length ? `${plural(itineraries.length, 'route')} to ${to.name}` : 'No routes found');
  if (!itineraries.length) {
    sheet.setContent(`<div class="state-message"><h2>No routes found</h2>
      <p>Try a different time${state.plan.stepFree ? ', or turn off step-free routes to see more options' : ''}.</p></div>`);
    return;
  }
  const fewest = affectingCount(itineraries[0]) < Math.max(...itineraries.map(affectingCount));
  sheet.setContent(`
    <div class="sheet-head">
      <div><p class="eyebrow">Route options</p><h2>To ${esc(to.name)}</h2>
        <p class="route-query">From ${esc(from.name)} · ${queryLine()}</p></div>
    </div>
    <ol class="route-card-list">${itineraries.map((it, i) => routeCardHtml(it, i, { selected: false, fewest: fewest && i === 0 })).join('')}</ol>
    ${sourceNote()}`);
}

function renderRoute() {
  const it = state.plan.itineraries[state.selected];
  sheet.setTitle(`${minutes(it.duration)} · ${it.transfers ? plural(it.transfers, 'transfer') : 'no transfers'} · ${it.barriers.filter((b) => b.affectsYou).length ? 'barriers on route' : 'no barriers reported'}`);
  sheet.setContent(`<button type="button" class="back-link sheet-back" data-action="back">${icon('back')}All routes</button>
    ${routeDetailHtml(it, state.places, { stepFree: state.plan.stepFree })}
    ${sourceNote()}`);
}

const sourceNote = () => `<p class="routing-source-note">${icon('info', 16)}<span>Routes by <a href="https://transitous.org">Transitous</a>, a free community trip planner (<a href="https://transitous.org/sources/">data sources</a>). Barrier notices come from AccessLoop reports.</span></p>`;

// ---------- Planner (floating card) ----------

function setPlace(key, place) {
  state.places[key] = place ? { name: place.name, lat: place.lat, lng: place.lng } : null;
  (key === 'from' ? els.fromInput : els.toInput).value = place?.name ?? '';
  updateTripState();
}

// Once a trip is under way, the planner offers a Clear button (and stays fully open on phones).
function updateTripState() {
  const started = Boolean(state.places.from || state.places.to || state.plan || els.fromInput.value || els.toInput.value);
  els.form.classList.toggle('has-trip', started);
  els.clearTrip.hidden = !started;
}

function setMode(mode) {
  state.mode = mode;
  els.app.dataset.mode = mode;
  els.form.hidden = mode !== 'planning';
  els.summary.hidden = !(mode === 'results' || mode === 'route');
  if (!els.summary.hidden) {
    const { from, to } = state.places;
    $('summary-from').textContent = from.name;
    $('summary-to').textContent = to.name;
    $('summary-meta').textContent = queryLine();
  }
}

function openPlanner({ focus } = {}) {
  setMode('planning');
  if (sheet.state === 'full') sheet.set('half'); // keep the planner clear of the panel
  if (focus === 'from' || (!focus && !state.places.from)) els.fromInput.focus();
  else if (focus === 'to' || !state.places.to) els.toInput.focus();
}

// "Plan a trip here" on a barrier: it becomes the destination, from your location if there's no start.
function planTo(l) {
  setPlace('to', { name: l.label, lat: l.latitude, lng: l.longitude });
  openPlanner({ focus: 'from' });
  if (state.places.from) planTrip();
  else useMyLocationAsStart({ quiet: true });
}

// Clear: forget the trip, remove the routes and give the whole map back.
function clearTrip() {
  state.plan = null;
  routeLayer.clearLayers();
  setPlace('from', null);
  setPlace('to', null);
  els.plannerError.innerHTML = '';
  setMode('planning');
  setView('map');
  els.toInput.focus();
}

function placeItem(p) {
  return `<span>${icon(p.type === 'STOP' ? 'station' : 'location', 18)}</span>
    <span><strong>${esc(p.name)}</strong><small>${esc(p.typeLabel)}${p.area ? ` · ${esc(p.area)}` : ''}</small></span>`;
}
const searchPlaces = (q) => api(`/places?q=${encodeURIComponent(q)}`);

for (const key of ['from', 'to']) {
  const input = key === 'from' ? els.fromInput : els.toInput;
  createCombobox({
    input,
    list: $(`${key}-results`),
    idPrefix: `${key}-place`,
    search: searchPlaces,
    renderItem: placeItem,
    emptyText: 'No matching places in or around Toronto',
    onChoose: (p) => {
      setPlace(key, p);
      els.plannerError.innerHTML = '';
      if (state.places.from && state.places.to) planTrip();
      else if (key === 'to') {
        // Like a maps app: with no start chosen, start from where you are.
        els.fromInput.focus();
        useMyLocationAsStart({ quiet: true });
      } else els.toInput.focus();
    },
  });
  input.addEventListener('input', () => {
    state.places[key] = null; // typing clears the earlier choice
    updateTripState();
  });
}

function useMyLocationAsStart({ quiet = false } = {}) {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (quiet && state.places.from) return; // a start was chosen in the meantime
      if (quiet && els.fromInput.value.trim()) return; // someone is typing a start
      const here = { name: 'My location', lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!inArea(here)) {
        if (!quiet) els.plannerError.innerHTML = '<p class="form-message" role="alert">You’re outside the area AccessLoop covers. Search for a starting point instead.</p>';
        return;
      }
      setPlace('from', here);
      announce('Start set to your location.');
      if (state.places.to && state.mode === 'planning') planTrip();
    },
    () => {
      if (!quiet) els.plannerError.innerHTML = '<p class="form-message" role="alert">Location is off. Search for a starting point instead.</p>';
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
  );
}

async function planTrip() {
  const { from, to } = state.places;
  const fail = (text, field) => {
    els.plannerError.innerHTML = `<p class="form-message" role="alert">${esc(text)}</p>`;
    field?.focus();
  };
  if (!from) return fail('Choose a starting point from the list, or use your location.', els.fromInput);
  if (!to) return fail('Choose a destination from the list.', els.toInput);
  if (els.when.value !== 'now' && !els.whenTime.value) return fail('Choose a date and time.', els.whenTime);
  els.plannerError.innerHTML = '';

  const params = new URLSearchParams({ from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`, stepFree: String(els.stepFree.checked) });
  if (els.when.value !== 'now') {
    params.set('time', new Date(els.whenTime.value).toISOString());
    if (els.when.value === 'arrive') params.set('arriveBy', 'true');
  }

  const submit = els.form.querySelector('.planner-submit');
  submit.disabled = true;
  submit.textContent = 'Finding routes…';
  try {
    const plan = await api(`/trips?${params}`);
    // Routes with the fewest barriers that affect you come first, then the earliest arrival.
    plan.itineraries.sort((a, b) => affectingCount(a) - affectingCount(b) || new Date(a.endTime) - new Date(b.endTime));
    state.plan = plan;
    state.selected = 0;
    setMode('results');
    setView('results', { open: 'half' });
    drawCurrentRoutes({ fit: true });
    announce(plan.itineraries.length ? `${plural(plan.itineraries.length, 'route')} found.` : 'No routes found.');
    $('sheet').querySelector('.route-card button')?.focus({ preventScroll: true });
  } catch (err) {
    fail(err.message);
  } finally {
    submit.disabled = false;
    submit.innerHTML = `Find routes ${icon('arrow')}`;
  }
}

function drawCurrentRoutes({ fit = false } = {}) {
  if (!state.plan?.itineraries.length) return routeLayer.clearLayers();
  const bounds = drawRoutes(routeLayer, state.plan.itineraries, state.selected, state.places.from, state.places.to, {
    onSelect: selectRoute,
  });
  if (fit) map.fitBounds(bounds, { ...viewPadding(), maxZoom: 16, animate: !reduceMotion });
}

function selectRoute(index) {
  state.selected = index;
  setMode('route');
  setView('route', { open: 'half' });
  drawCurrentRoutes({ fit: true });
  $('route-detail-title')?.focus({ preventScroll: true });
}

// The stops where you get on, transfer and get off, offered as places to report.
function routeStops() {
  const it = state.plan?.itineraries[state.selected];
  if (!it || !(state.mode === 'route' || state.mode === 'results')) return null;
  const stops = it.legs.filter((l) => l.transit).flatMap((l) => [l.from, l.to]);
  const seen = new Set();
  return stops.filter((s) => (seen.has(s.name) ? false : seen.add(s.name))).map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));
}

// ---------- Quick report ----------

const quickReport = createQuickReport({
  root: $('quick-report'),
  button: $('report-button'),
  getRouteStops: routeStops,
  onSubmitted: async () => {
    await loadReports().catch(() => {});
    if (state.plan) refreshPlanBarriers();
  },
});

// After a new report, plan again quietly so the route's barrier list includes it.
async function refreshPlanBarriers() {
  const { from, to } = state.places;
  try {
    const plan = await api(`/trips?${new URLSearchParams({ from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`, stepFree: String(state.plan.stepFree) })}`);
    if (plan.itineraries.length === state.plan.itineraries.length) {
      state.plan.itineraries.forEach((it, i) => (it.barriers = plan.itineraries.find((p) => p.id === it.id)?.barriers ?? plan.itineraries[i].barriers));
      if (state.view === 'route' || state.view === 'results') setView(state.view);
    }
  } catch {
    // Keep the current list if the trip planner can't be reached.
  }
}

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
  if (button.dataset.itinerary) {
    selectRoute(Number(button.dataset.itinerary));
  } else if (button.dataset.barrier) {
    const it = state.plan.itineraries[state.selected];
    const found = it.barriers.find((x) => x.report.id === Number(button.dataset.barrier));
    openBarrier([found.report], 0, button);
  } else if (button.dataset.action === 'back') {
    const target = state.view === 'barrier' ? b.back : state.view === 'route' ? 'results' : 'map';
    if (target === 'results') setMode('results');
    setView(['results', 'route'].includes(target) ? target : 'map');
    drawCurrentRoutes();
    if (target === 'map' && b?.opener?.isConnected) b.opener.focus({ preventScroll: true }); // back to the pin
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
  } else if (button.dataset.action === 'plan-here') {
    planTo(b.reports[b.index].location);
  } else if (button.dataset.stopLeg) {
    // "Report at get-on stop" / "get-off stop" on a ride: the pop-up opens with that stop filled in.
    const leg = state.plan.itineraries[state.selected].legs[Number(button.dataset.stopLeg)];
    const stop = leg[button.dataset.stopEnd];
    quickReport.open({ preset: routeStop({ name: stop.name, lat: stop.lat, lng: stop.lng, stopCode: stop.stopCode, mode: leg.mode }) });
  } else if (button.dataset.action === 'report-route') {
    quickReport.open();
  }
});

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  planTrip();
});
els.planner.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close-planner') clearTrip();
  else if (action === 'edit-trip') openPlanner({ focus: 'to' });
  else if (action === 'locate-from') useMyLocationAsStart();
  else if (action === 'swap') {
    const { from, to } = state.places;
    const [fromText, toText] = [els.fromInput.value, els.toInput.value];
    setPlace('from', to);
    setPlace('to', from);
    if (!to) els.fromInput.value = toText;
    if (!from) els.toInput.value = fromText;
    if (state.places.from && state.places.to) planTrip();
  }
});
els.planner.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.mode === 'planning' && state.plan) {
    setMode(state.view === 'route' ? 'route' : 'results');
    els.summary.focus();
  }
});
els.when.addEventListener('change', () => {
  els.whenTime.hidden = els.when.value === 'now';
  if (!els.whenTime.hidden && !els.whenTime.value) {
    const soon = new Date(Date.now() + 15 * 60000);
    soon.setSeconds(0, 0);
    els.whenTime.value = new Date(soon - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
});
els.stepFree.addEventListener('change', () => {
  if (state.places.from && state.places.to && state.plan) planTrip();
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
      announce('Location is off. Search for a place instead.');
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

setMode('planning');
updateTripState();
start();
