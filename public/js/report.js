// Report a barrier: three taps (barrier, location, details), then the private edit key.
import { api } from './api.js';
import {
  esc,
  icon,
  barrierIcon,
  KIND_COPY,
  KIND_ORDER,
  formatKm,
  timeAgo,
  getParam,
  mountChrome,
  loadingMessage,
  errorMessage,
} from './ui.js';

mountChrome('report');

const main = document.getElementById('main-content');
const STEP_NAMES = { 1: 'Barrier', 2: 'Location', 3: 'Details' };
const MAX_RESULTS = 30;
const NEARBY_RESULTS = 15;

const state = {
  step: 1,
  categories: [],
  results: [], // stops the server found for the location step
  category: null,
  location: null,
  description: '',
  search: '',
  you: null, // { lat, lng } after "Use my location". Used to sort stops, never saved.
  locating: false,
  locateError: null,
  submitting: false,
  error: null,
  created: null, // { report, editKey } after submitting
  copied: false, // true once copied, or 'selected' if the clipboard was blocked
};

// ---------- Steps and browser history ----------

function goTo(step, { push = true } = {}) {
  state.step = step;
  state.error = null;
  if (push) history.pushState({ step }, '');
  render();
  window.scrollTo(0, 0);
  main.querySelector('h1')?.focus({ preventScroll: true });
}

// The browser's back button moves between steps instead of leaving the form.
window.addEventListener('popstate', (e) => {
  if (state.created) return;
  const step = e.state?.step ?? 1;
  const allowed = step === 1 || (step === 2 && state.category) || (step === 3 && state.category && state.location);
  goTo(allowed ? step : 1, { push: false });
});

function render() {
  if (state.created) return renderConfirmation();
  main.className = 'report-wizard';
  main.innerHTML = `
    <div class="wizard-header">
      <button class="back-link" type="button" data-action="back">${icon('back')}${state.step === 1 ? 'Cancel' : 'Back'}</button>
      <div class="wizard-progress" role="img" aria-label="Step ${state.step} of 3: ${STEP_NAMES[state.step]}">
        ${[1, 2, 3].map((n) => `<span class="${state.step >= n ? 'active' : ''}"><i></i><b>${STEP_NAMES[n]}</b></span>`).join('')}
      </div>
      <span class="wizard-step-count" aria-hidden="true">${state.step} of 3</span>
    </div>
    ${state.step === 1 ? stepOne() : state.step === 2 ? stepTwo() : stepThree()}`;
  if (state.step === 2) renderLocationResults();
  if (state.step === 3) checkForDuplicates();
}

// ---------- Step 1: what did you find? ----------

function stepOne() {
  const groups = KIND_ORDER.map((kind) => {
    const tiles = state.categories
      .filter((c) => c.kind === kind)
      .map(
        (c) => `<button type="button" class="report-tile" data-category="${c.id}">
          ${barrierIcon(c, { size: 34 })}<span>${esc(c.name)}</span>${icon('chevron', 19)}</button>`,
      )
      .join('');
    return `<section aria-labelledby="group-${kind}">
      <div class="tile-group-heading"><h2 id="group-${kind}">${KIND_COPY[kind].title}</h2><span>${KIND_COPY[kind].hint}</span></div>
      <div class="report-tile-grid">${tiles}</div>
    </section>`;
  }).join('');

  return `<section class="wizard-screen">
    <p class="eyebrow">Step 1 of 3</p>
    <h1 tabindex="-1">What did you find?</h1>
    <p class="lede">Choose the barrier that best matches what you see.</p>
    ${state.location ? `<p class="report-at">${icon('location', 18)}At ${esc(state.location.label)}</p>` : ''}
    <div class="report-tile-groups">${groups}</div>
  </section>`;
}

// ---------- Step 2: where is it? ----------

function stepTwo() {
  const found = Boolean(state.you);
  const title = found ? 'Nearest stops found' : state.locating ? 'Finding stops near you…' : 'Use my location';
  return `<section class="wizard-screen wizard-location">
    <p class="eyebrow">Step 2 of 3</p>
    <h1 tabindex="-1">Where is the barrier?</h1>
    <p class="lede">Choose a station, stop or exact spot from the list.</p>
    <button type="button" class="use-location" data-action="locate"${state.locating ? ' aria-busy="true"' : ''}>
      <span>${icon('location', 27)}</span>
      <div>
        <strong>${title}</strong>
        <small>${found ? 'Showing stops and stations near you' : 'Used once to find nearby stops. It’s never saved.'}</small>
      </div>
      ${icon(found ? 'check' : 'chevron')}
    </button>
    ${state.locateError ? `<p class="form-message" role="alert">${esc(state.locateError)}</p>` : ''}
    <div class="location-divider"><span>or search</span></div>
    <label class="search-box" for="location-search">
      <span class="sr-only">Search stations and stops</span>
      ${icon('search', 23)}
      <input id="location-search" type="search" placeholder="Station, street or stop number" autocomplete="off"
        value="${esc(state.search)}" aria-controls="location-results">
    </label>
    <div class="location-results" id="location-results"></div>
  </section>`;
}

// There are thousands of stops, so the server searches them and sorts by distance.
let searchTimer;
let searchRequest = 0;

async function renderLocationResults() {
  const box = document.getElementById('location-results');
  if (!box) return;
  const search = state.search.trim();
  if (!search && !state.you) {
    box.innerHTML = `<div class="state-message"><h2>Find the stop</h2>
      <p>Type a station, a street name or the stop number on the pole, or use your location.</p></div>`;
    return;
  }

  const params = new URLSearchParams({ limit: search ? MAX_RESULTS : NEARBY_RESULTS });
  if (search) params.set('q', search);
  if (state.you) params.set('near', `${state.you.lat},${state.you.lng}`);
  const id = ++searchRequest;
  let list;
  try {
    list = await api(`/locations?${params}`);
  } catch (err) {
    if (id === searchRequest) box.innerHTML = errorMessage('Stops couldn’t load', err.message, { retry: false });
    return;
  }
  if (id !== searchRequest || !document.getElementById('location-results')) return;
  state.results = list;

  const rows = list
    .map(
      (l) => `<button type="button" data-location="${l.id}">
        <span class="location-result-icon">${icon(l.type === 'SUBWAY_STATION' ? 'station' : 'location')}</span>
        <span><strong>${esc(l.label)}</strong><small>${esc(l.typeLabel)}${l.line ? ` · ${esc(l.line)}` : ''}${l.code ? ` · Stop ${esc(l.code)}` : ''}</small></span>
        ${l.distanceKm !== undefined ? `<b>${formatKm(l.distanceKm)}</b>` : ''}
        ${icon('chevron')}
      </button>`,
    )
    .join('');

  box.innerHTML = `
    <h2>${state.you && !search ? 'Nearest to you' : 'Stations and stops'}</h2>
    <p class="sr-only" role="status">${list.length} ${list.length === 1 ? 'match' : 'matches'}</p>
    ${rows || `<div class="state-message"><h2>No matching stops</h2><p>${
      state.you && !search ? 'No stops found near you. Try searching instead.' : 'Try a street name, station or stop number.'
    }</p></div>`}
    ${search && list.length === MAX_RESULTS ? '<p class="results-note">Keep typing to narrow the list.</p>' : ''}`;
}

function locate() {
  if (!('geolocation' in navigator)) {
    state.locateError = 'Your browser can’t share your location. Search for the stop instead.';
    return render();
  }
  state.locating = true;
  state.locateError = null;
  render();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.you = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.locating = false;
      render();
    },
    () => {
      state.locating = false;
      state.locateError = 'Location is off, so we can’t sort by distance. Search for the stop instead.';
      render();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
  );
}

// ---------- Step 3: details ----------

function stepThree() {
  const { category, location } = state;
  return `<section class="wizard-screen wizard-details">
    <p class="eyebrow">Step 3 of 3</p>
    <h1 tabindex="-1">Anything riders should know?</h1>
    <div class="report-summary">
      ${barrierIcon(category, { size: 28 })}
      <div class="summary-lines">
        <div class="summary-line">
          <span><small>Barrier</small><strong>${esc(category.name)}</strong></span>
          <button type="button" data-goto="1" aria-label="Change barrier">Change</button>
        </div>
        <div class="summary-line">
          <span><small>Location</small><strong>${esc(location.label)}</strong></span>
          <button type="button" data-goto="2" aria-label="Change location">Change</button>
        </div>
      </div>
    </div>
    <div id="duplicate-slot"></div>
    <form id="report-form" novalidate>
      <div class="wizard-description">
        <label class="field-label" for="description">Add a description <span>Optional</span></label>
        <textarea id="description" maxlength="1000" placeholder="What should another rider know?"
          aria-describedby="description-count">${esc(state.description)}</textarea>
        <div class="counter" id="description-count">${state.description.length} / 1,000</div>
      </div>
      <div id="submit-error">${state.error ? `<p class="form-message" role="alert">${esc(state.error)}</p>` : ''}</div>
      <button class="button submit-button" type="submit"${state.submitting ? ' disabled' : ''}>
        ${state.submitting ? 'Adding…' : `Add report to map ${icon('arrow')}`}
      </button>
      <p class="privacy-note">Your report is public. Do not include names, phone numbers or other private information.</p>
    </form>
  </section>`;
}

// If the same barrier is already open at this spot, suggest confirming it instead.
async function checkForDuplicates() {
  const { category, location } = state;
  try {
    const { reports } = await api(`/reports?locationId=${location.id}&categoryId=${category.id}&status=open&limit=1`);
    const slot = document.getElementById('duplicate-slot');
    if (!reports.length || !slot || state.category !== category || state.location !== location) return;
    const existing = reports[0];
    slot.innerHTML = `<div class="duplicate-notice" role="note">
      ${icon('info')}
      <div>
        <strong>This may already be reported</strong>
        <p>“${esc(category.name)}” was reported here ${timeAgo(existing.createdAt)}. If it’s the same barrier, confirming it helps more than a second report.</p>
        <a href="barrier.html?id=${existing.id}">Confirm the existing report ${icon('arrow', 16)}</a>
      </div>
    </div>`;
  } catch {
    // The check is only a hint. If it fails, the rider can still submit.
  }
}

async function submit(e) {
  e.preventDefault();
  if (state.submitting) return;
  state.submitting = true;
  state.error = null;
  const button = main.querySelector('.submit-button');
  button.disabled = true;
  button.textContent = 'Adding…';
  try {
    const created = await api('/reports', {
      method: 'POST',
      body: {
        categoryId: state.category.id,
        locationId: state.location.id,
        description: state.description.trim() || null,
      },
    });
    state.created = created;
    history.replaceState({ done: true }, '');
    render();
    window.scrollTo(0, 0);
    main.querySelector('h1').focus({ preventScroll: true });
  } catch (err) {
    state.submitting = false;
    state.error = err.message;
    button.disabled = false;
    button.innerHTML = `Add report to map ${icon('arrow')}`;
    document.getElementById('submit-error').innerHTML = `<p class="form-message" role="alert">${esc(err.message)}</p>`;
  }
}

// ---------- Confirmation with the edit key ----------

function renderConfirmation() {
  const { report, editKey } = state.created;
  main.className = 'narrow-page confirmation';
  main.innerHTML = `
    <div class="success-icon">${icon('check', 34)}</div>
    <p class="eyebrow">Report added</p>
    <h1 tabindex="-1">Thanks! You just helped other riders plan their trip.</h1>
    <p>Your report is on the map and ready for the accessibility team to review.</p>
    <section class="key-card" aria-labelledby="key-title">
      <div class="warning-title">
        ${icon('info')}
        <div>
          <h2 id="key-title">Save your private edit key</h2>
          <p>This key is shown once. It will not be shown again.</p>
        </div>
      </div>
      <div class="key-row">
        <code id="edit-key">${esc(editKey)}</code>
        <button type="button" data-action="copy">${icon(state.copied === true ? 'check' : 'copy')}${state.copied === true ? 'Copied' : 'Copy key'}</button>
      </div>
      <p class="key-help">Use this key to change the description while your report is still marked Reported.</p>
      <p class="key-help" role="status">${
        state.copied === 'selected' ? 'The key is selected. Press Ctrl+C (or ⌘C on a Mac) to copy it.' : ''
      }</p>
    </section>
    <div class="confirmation-actions">
      <a class="button button-wide" href="index.html">Back to the live map ${icon('arrow')}</a>
      <a class="secondary-button" href="barrier.html?id=${report.id}">View your report</a>
    </div>`;
}

async function copyKey() {
  const key = state.created.editKey;
  try {
    await navigator.clipboard.writeText(key);
    state.copied = true;
  } catch {
    // Clipboard blocked: select the key and explain how to copy it.
    state.copied = 'selected';
  }
  renderConfirmation();
  main.querySelector('[data-action="copy"]').focus();
  if (state.copied === 'selected') {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('edit-key'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }
}

// ---------- Events ----------

main.addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;
  if (target.dataset.action === 'back') {
    if (state.step === 1) window.location.href = 'index.html';
    else goTo(state.step - 1);
  } else if (target.dataset.category) {
    state.category = state.categories.find((c) => c.id === Number(target.dataset.category));
    goTo(state.location ? 3 : 2);
  } else if (target.dataset.location) {
    state.location = state.results.find((l) => l.id === Number(target.dataset.location));
    goTo(3);
  } else if (target.dataset.goto) {
    goTo(Number(target.dataset.goto));
  } else if (target.dataset.action === 'locate') {
    locate();
  } else if (target.dataset.action === 'copy') {
    copyKey();
  } else if (target.dataset.retry !== undefined) {
    load();
  }
});

main.addEventListener('input', (e) => {
  if (e.target.id === 'location-search') {
    state.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderLocationResults, 200);
  } else if (e.target.id === 'description') {
    state.description = e.target.value;
    document.getElementById('description-count').textContent = `${state.description.length} / 1,000`;
  }
});

main.addEventListener('submit', submit);

// ---------- Start ----------

async function load() {
  main.className = 'narrow-page';
  main.innerHTML = loadingMessage('Loading the report form…');
  try {
    state.categories = await api('/categories');
    // "Report a barrier here" from the map passes the stop in the link.
    const presetId = Number(getParam('locationId'));
    state.location = presetId ? await api(`/locations/${presetId}`).catch(() => null) : null;
    history.replaceState({ step: 1 }, '');
    goTo(1, { push: false });
  } catch (err) {
    main.innerHTML = errorMessage('The report form couldn’t load', err.message);
  }
}

load();
