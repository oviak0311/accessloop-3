// Explore: every report on a map. Filters float at the top left; the bottom sheet lists the
// reports in view and shows a report's details when one is chosen.
// Filters are kept in the address bar, so a filtered map can be shared or bookmarked.
import { api } from './api.js';
import { TORONTO, createBaseMap, hasCoords, latLng } from './mapbase.js';
import { createPinLayer } from './pins.js';
import { createSheet } from './sheet.js';
import { barrierCardHtml, saveResponse } from './barrier-card.js';
import { createQuickReport } from './quick-report.js';
import { createPinCard } from './pin-card.js';
import { esc, icon, barrierIcon, statusPill, reportFlags, timeAgo, KIND_COPY, KIND_ORDER, mountChrome, errorMessage, sheetLinksHtml } from './ui.js';

mountChrome('explore');

const LIMIT = 200;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const els = {
  app: document.querySelector('.app-map'),
  filters: $('filters'),
  sidePanel: document.querySelector('.side-panel'),
  form: $('filter-form'),
  toggle: document.querySelector('.filter-toggle'),
  status: $('app-status'),
  legend: $('map-legend'),
};

const params = new URLSearchParams(window.location.search);
const filters = { q: params.get('q') ?? '', status: params.get('status') ?? '', kind: params.get('kind') ?? '' };
for (const [name, value] of Object.entries(filters)) els.form.elements[name].value = value;

const state = { reports: [], count: 0, view: 'list', barrier: null };

const map = createBaseMap('map', { zoomControl: false }).setView(TORONTO, 11);
L.control.zoom({ position: 'topright' }).addTo(map);
const pins = createPinLayer(map, { onPick: (reports, el) => openBarrier(reports, 0, el), labelsClassTarget: els.app });

// On a computer, a report's details open in a card on its pin, so the list stays on the left.
const pinCard = createPinCard(map, {
  getAvoid: () => {
    const appRect = els.app.getBoundingClientRect();
    return { topLeft: [els.sidePanel.getBoundingClientRect().right - appRect.left + 20, 20], bottomRight: [20, 20] };
  },
  onOpen: (report) => pins.setActive(report.location.id),
  onClose: () => pins.setActive(state.view === 'barrier' ? state.barrier.reports[state.barrier.index].location.id : null),
  onUpdated: (updated) => (state.reports = state.reports.map((r) => (r.id === updated.id ? updated : r))),
  onReportHere: (location) => quickReport.open({ preset: location }),
  onPlanHere: (l) => (window.location.href = `index.html?to=${l.latitude},${l.longitude}&toName=${encodeURIComponent(l.label)}`),
});
const sheet = createSheet($('sheet'), { footer: sheetLinksHtml() });
const quickReport = createQuickReport({
  root: $('quick-report'),
  button: $('report-button'),
  getRouteStops: () => null,
  onSubmitted: () => load({ fit: false }),
});

const announce = (text) => {
  els.status.textContent = '';
  requestAnimationFrame(() => (els.status.textContent = text));
};
// Room the map should leave for the floating panels: the side card on desktop,
// the filters at the top and the sheet below on phones.
function viewPadding() {
  const appRect = els.app.getBoundingClientRect();
  if (window.innerWidth > 800) {
    const panelRect = els.sidePanel.getBoundingClientRect();
    return { paddingTopLeft: [panelRect.right - appRect.left + 40, 40], paddingBottomRight: [80, 40] };
  }
  const filterRect = els.filters.getBoundingClientRect();
  const sheetHeight = parseFloat(getComputedStyle(els.app).getPropertyValue('--sheet-now')) || 64;
  return { paddingTopLeft: [24, filterRect.bottom - appRect.top + 16], paddingBottomRight: [24, sheetHeight + 24] };
}
function fitAll() {
  const points = state.reports.filter((r) => hasCoords(r.location)).map((r) => latLng(r.location));
  if (points.length) map.fitBounds(points, { ...viewPadding(), maxZoom: 15, animate: !reduceMotion });
}

// ---------- Data ----------

let requestId = 0;
let debounce;

async function load({ fit = true } = {}) {
  const id = ++requestId;
  if (pinCard.isOpen) pinCard.close(); // the filters may hide that report
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  history.replaceState(null, '', query.toString() ? `?${query}` : window.location.pathname);
  query.set('limit', LIMIT);
  sheet.setTitle('Loading reports…');
  try {
    const { reports, count } = await api(`/reports?${query}`);
    if (id !== requestId) return; // a newer search has started
    state.reports = reports;
    state.count = count;
    pins.setReports(reports);
    if (fit) fitAll();
    if (state.view === 'list') renderList();
    announce(`${count} ${count === 1 ? 'report' : 'reports'} match.`);
  } catch (err) {
    if (id !== requestId) return;
    sheet.setTitle('Reports couldn’t load');
    sheet.setContent(errorMessage('Reports couldn’t load', err.message));
    sheet.open('half');
  }
}

// ---------- Sheet views ----------

function renderList() {
  const bounds = map.getBounds();
  const inView = state.reports.filter((r) => hasCoords(r.location) && bounds.contains(latLng(r.location)));
  const n = inView.length;
  sheet.setTitle(`${n} ${n === 1 ? 'report' : 'reports'} in this area`);
  sheet.setContent(`
    <div class="sheet-head">
      <div><p class="eyebrow">${state.count} matching ${state.count === 1 ? 'report' : 'reports'}</p>
        <h2>${n} in this area</h2></div>
      <div class="sheet-head-links">
        <button type="button" class="text-link" data-action="fit">Show all on the map ${icon('arrow', 16)}</button>
        <a class="text-link" href="insights.html">See patterns in Insights ${icon('arrow', 16)}</a>
      </div>
    </div>
    ${
      n
        ? `<ul class="nearby-list">${inView
            .map((r) => {
              const flags = reportFlags(r);
              const when = r.isOpen ? `Last confirmed ${timeAgo(r.lastConfirmedAt)}` : `Closed ${timeAgo(r.lastStatusChangeAt)}`;
              return `<li><button type="button" class="nearby-card" data-report="${r.id}">
                ${barrierIcon(r.category, { size: 22 })}
                <span class="nearby-card-text">
                  <strong>${esc(r.category.name)}</strong>
                  <span>${esc(r.location.label)}</span>
                  ${flags.length ? `<small class="map-report-flag">${esc(flags.join(' · '))}</small>` : ''}
                  <span class="nearby-card-meta">${statusPill(r)}<small>${when}${r.isSample ? ' · Sample' : ''}</small></span>
                </span>
              </button></li>`;
            })
            .join('')}</ul>`
        : `<div class="empty-state"><h2>No reports in this area</h2><p>Move the map, remove a filter or search for a different location.</p></div>`
    }
    ${state.count === LIMIT ? `<p class="results-note">Showing the ${LIMIT} newest matches. Add a filter to narrow them down.</p>` : ''}`);
}

function openBarrier(reports, index, opener = null) {
  if (window.innerWidth > 800) {
    // Opened from the list, the stop may be inside a numbered bubble: zoom to its pin.
    const l = reports[index].location;
    if (pins.isClustered(l.id)) map.setView(latLng(l), pins.SPREAD_ZOOM, { animate: false });
    return pinCard.open(reports, index, { opener });
  }
  state.barrier = { reports, index };
  state.view = 'barrier';
  els.app.dataset.view = 'barrier';
  pins.setActive(reports[index].location.id);
  renderBarrier();
  sheet.open('half');
  const point = latLng(reports[index].location);
  map.fitBounds(L.latLngBounds([point, point]), { ...viewPadding(), maxZoom: Math.max(map.getZoom(), 15), animate: !reduceMotion });
  $('barrier-view-title')?.focus({ preventScroll: true });
}

function renderBarrier() {
  const report = state.barrier.reports[state.barrier.index];
  sheet.setTitle(report.category.name);
  sheet.setContent(`<button type="button" class="back-link sheet-back" data-action="back">${icon('back')}Reports in this area</button>${barrierCardHtml(state.barrier)}`);
}

function backToList() {
  state.view = 'list';
  els.app.dataset.view = 'list';
  pins.setActive(null);
  renderList();
}

// ---------- Events ----------

$('sheet').addEventListener('click', async (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  const b = state.barrier;
  if (button.dataset.report) {
    const report = state.reports.find((r) => r.id === Number(button.dataset.report));
    const list = pins.places().get(report.location.id)?.reports ?? [report];
    openBarrier(list, list.indexOf(report), button);
  } else if (button.dataset.action === 'fit') {
    fitAll();
  } else if (button.dataset.action === 'back') {
    backToList();
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
    quickReport.open({ preset: b.reports[b.index].location });
  } else if (button.dataset.action === 'plan-here') {
    const l = b.reports[b.index].location;
    window.location.href = `index.html?to=${l.latitude},${l.longitude}&toName=${encodeURIComponent(l.label)}`;
  }
});

els.form.addEventListener('submit', (e) => e.preventDefault());
els.form.addEventListener('input', (e) => {
  if (e.target.name !== 'q') return;
  filters.q = e.target.value.trim();
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (state.view !== 'list') backToList();
    load();
  }, 300);
});
els.form.addEventListener('change', (e) => {
  if (e.target.name === 'q') return;
  filters[e.target.name] = e.target.value;
  if (state.view !== 'list') backToList();
  load();
});
els.toggle.addEventListener('click', () => {
  const open = !els.filters.classList.contains('is-open');
  els.filters.classList.toggle('is-open', open);
  els.toggle.setAttribute('aria-expanded', String(open));
});

map.on('moveend', () => {
  if (state.view === 'list') renderList();
});

// The header's "Report a barrier" opens the quick menu here too.
document.querySelector('.site-header').addEventListener('click', (e) => {
  if (!e.target.closest('a[href^="index.html?report"]')) return;
  e.preventDefault();
  quickReport.open();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) load();
});

els.legend.innerHTML =
  KIND_ORDER.map((kind) => {
    const example = { EQUIPMENT: 'Elevator', CONDITION: 'Construction', INFRASTRUCTURE: 'No shelter' }[kind];
    return `<span>${barrierIcon({ name: example, kind }, { size: 15 })}${KIND_COPY[kind].short}</span>`;
  }).join('') + `<span class="legend-closed">${barrierIcon({ name: 'Closed', kind: 'EQUIPMENT' }, { size: 15 })}Closed</span>`;

load();
