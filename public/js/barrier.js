// One barrier: status, rider responses, status timeline, location history and editing.
import { api } from './api.js';
import { createBaseMap, pinIcon, hasCoords, latLng } from './mapbase.js';
import {
  esc,
  icon,
  barrierIcon,
  statusPill,
  timeAgo,
  formatDate,
  formatDateTime,
  KIND_COPY,
  STATUS_LABELS,
  STATUS_PATHS,
  recentResponse,
  rememberResponse,
  getParam,
  mountChrome,
  loadingMessage,
  errorMessage,
} from './ui.js';

mountChrome('explore');

const main = document.getElementById('main-content');
const reportId = Number(getParam('id'));
const DAY = 24 * 60 * 60 * 1000;
const NOT_INCIDENTS = ['DUPLICATE', 'COULD_NOT_VERIFY']; // not counted as separate incidents

let report = null;
let miniMap = null;
const ui = { justVoted: false, voteError: null, editOpen: false, editError: null, editSaved: false };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- Sections ----------

function flagsHtml() {
  const notes = [];
  if (report.riderSays) {
    const gone = report.category.responseOptions[1].label;
    notes.push([report.riderSays, `A rider marked this “${gone}” after the last status update. The accessibility team will check it.`]);
  }
  if (report.mayHaveCleared) {
    notes.push(['May have cleared', 'No rider has confirmed this barrier in the last 48 hours.']);
  }
  if (report.status === 'DUPLICATE' && report.duplicateOf) {
    notes.push([
      'Duplicate report',
      `This barrier was already reported. Updates continue on the original: <a href="barrier.html?id=${report.duplicateOf.id}">${esc(report.duplicateOf.title)}</a>.`,
    ]);
  }
  return notes
    .map(([title, text]) => `<div class="flag detail-flag">${icon('info')}<div><strong>${esc(title)}</strong><p>${text}</p></div></div>`)
    .join('');
}

function aboutHtml() {
  const l = report.location;
  const extra = report.duplicates.length
    ? `<div><dt>Also reported</dt><dd>${plural(report.duplicates.length, 'duplicate report')} point here</dd></div>`
    : '';
  return `<section class="detail-section" aria-labelledby="about-title">
    <h2 id="about-title">About this barrier</h2>
    <p>${report.description ? esc(report.description) : 'No description was added.'}</p>
    <dl class="detail-list">
      <div><dt>Location</dt><dd>${esc(l.label)}</dd></div>
      <div><dt>Stop</dt><dd>${esc(l.typeLabel)}${l.line ? ` · ${esc(l.line)}` : ''}</dd></div>
      <div><dt>Barrier kind</dt><dd>${KIND_COPY[report.category.kind].title}</dd></div>
      <div><dt>Reported</dt><dd>${formatDateTime(report.createdAt)}</dd></div>
      ${report.resolvedAt ? `<div><dt>Fixed</dt><dd>${formatDateTime(report.resolvedAt)}</dd></div>` : ''}
      ${extra}
    </dl>
    ${
      hasCoords(l)
        ? `<div class="mini-map" id="mini-map" role="region" aria-label="Map showing ${esc(l.label)}"></div>
           <p class="detail-links">
             <a class="text-link" href="index.html?location=${l.id}">See it on the live map ${icon('arrow', 18)}</a>
             <a class="text-link" href="index.html?to=${l.latitude},${l.longitude}&amp;toName=${encodeURIComponent(l.label)}">Plan a trip here ${icon('arrow', 18)}</a>
           </p>`
        : ''
    }
  </section>`;
}

// What has happened (from the history table), then the steps still ahead for this kind.
function timelineHtml() {
  const steps = report.history.map((h) => ({ label: h.newStatusLabel, at: h.createdAt, note: h.note, done: true }));
  if (report.isOpen) {
    const path = STATUS_PATHS[report.category.kind];
    path.slice(path.indexOf(report.status) + 1).forEach((s) => steps.push({ label: STATUS_LABELS[s], done: false }));
  }
  return `<ol class="timeline">
    ${steps
      .map(
        (s) => `<li class="timeline-step ${s.done ? 'complete' : 'upcoming'}">
        <div class="timeline-marker">${s.done ? icon('check', 15) : '<span></span>'}</div>
        <div>
          <div class="timeline-title">
            <strong>${esc(s.label)}${s.done ? '' : '<span class="sr-only"> (not reached yet)</span>'}</strong>
            ${s.done ? `<time datetime="${new Date(s.at).toISOString()}">${formatDateTime(s.at)}</time>` : ''}
          </div>
          ${s.note ? `<p class="timeline-note">${esc(s.note)}</p>` : ''}
        </div>
      </li>`,
      )
      .join('')}
  </ol>`;
}

// Reports at this exact spot in the last 30 days, in five 6-day periods.
function locationHistoryHtml() {
  const lh = report.locationHistory;
  const bins = [0, 0, 0, 0, 0];
  for (const r of lh.reports) {
    if (NOT_INCIDENTS.includes(r.status)) continue;
    const ageDays = (Date.now() - new Date(r.createdAt)) / DAY;
    if (ageDays < 30) bins[4 - Math.floor(ageDays / 6)] += 1;
  }
  const max = Math.max(1, ...bins);
  const others = lh.reports.filter((r) => !r.isThisReport).slice(0, 5);
  const n = lh.reportsLast30Days;

  return `<section class="detail-section location-history" aria-labelledby="location-history-title">
    <div>
      <p class="eyebrow">Location history</p>
      <h2 id="location-history-title">This spot has had ${plural(n, 'report')} in the last 30 days</h2>
      <p>${plural(lh.totalReports, 'report')} here in total. Repeated reports show where barriers keep coming back.</p>
    </div>
    <div>
      <div class="history-bars" role="img"
        aria-label="Reports here in the last 30 days, in 6-day periods from oldest to newest: ${bins.join(', ')}">
        ${bins.map((b) => `<span class="${b ? '' : 'empty'}" style="height:${b ? Math.round((b / max) * 100) : 4}%"></span>`).join('')}
      </div>
      <div class="history-axis" aria-hidden="true"><span>30 days ago</span><span>Today</span></div>
    </div>
    ${
      others.length
        ? `<ul class="history-list" aria-label="Other reports at this spot">
          ${others
            .map(
              (r) => `<li>
              <span><a href="barrier.html?id=${r.id}">${esc(r.category)}</a><small>${formatDate(r.createdAt)}</small></span>
              ${statusPill({ status: r.status, statusLabel: STATUS_LABELS[r.status] })}
            </li>`,
            )
            .join('')}
        </ul>`
        : ''
    }
  </section>`;
}

function editHtml() {
  if (report.status !== 'REPORTED') return '';
  const form = `<form class="edit-form" id="edit-form" novalidate>
      <div>
        <label class="field-label" for="edit-key">Private edit key</label>
        <input id="edit-key" name="editKey" autocomplete="off" spellcheck="false" required>
      </div>
      <div>
        <label class="field-label" for="edit-description">Description</label>
        <textarea id="edit-description" name="description" maxlength="1000">${esc(report.description ?? '')}</textarea>
      </div>
      <div id="edit-error">${ui.editError ? `<p class="form-message" role="alert">${esc(ui.editError)}</p>` : ''}</div>
      <div class="form-actions">
        <button class="button button-small" type="submit">Save changes</button>
        <button class="secondary-button" type="button" data-action="cancel-edit">Cancel</button>
      </div>
    </form>`;
  return `<section class="edit-section" aria-labelledby="edit-title">
    <h2 id="edit-title">Is this your report?</h2>
    <p>You can edit the description while its status is Reported.</p>
    ${ui.editSaved ? '<p class="form-message success" role="status">Your changes were saved.</p>' : ''}
    ${ui.editOpen ? form : '<button type="button" class="secondary-button" data-action="edit">Edit my report</button>'}
  </section>`;
}

function responseHtml() {
  if (!report.isOpen) {
    return `<div class="closed-outcome">
      ${icon('check', 28)}
      <div>
        <strong>Report closed: ${esc(report.statusLabel)}</strong>
        <p>This report is no longer accepting rider responses.</p>
        ${
          report.duplicateOf
            ? `<a class="text-link" href="barrier.html?id=${report.duplicateOf.id}">View the original report ${icon('arrow', 18)}</a>`
            : ''
        }
      </div>
    </div>`;
  }
  const earlier = recentResponse(report.id);
  const buttons = report.category.responseOptions
    .map((o, i) => {
      const count = report.responseCounts[o.value] ?? 0;
      const chosen = earlier?.value === o.value;
      return `<button type="button" class="${i === 0 ? 'response-primary' : 'response-secondary'}" data-response="${o.value}"
          aria-pressed="${chosen}"${earlier ? ' disabled' : ''}>
        ${icon(chosen || i ? 'check' : 'eye')}
        <span><strong>${esc(o.label)}</strong><small>${plural(count, 'rider')}</small></span>
      </button>`;
    })
    .join('');
  return `<div class="response-area">
    <h2 id="response-title" tabindex="-1">What do you see now?</h2>
    <p>Your response helps other riders and the accessibility team.</p>
    <div class="response-buttons" role="group" aria-labelledby="response-title">${buttons}</div>
    ${ui.voteError ? `<p class="form-message" role="alert">${esc(ui.voteError)}</p>` : ''}
    ${
      earlier
        ? `<p class="vote-thanks" role="status">${icon('check', 18)}${
            ui.justVoted ? 'Thanks. Your response was added.' : `You answered ${timeAgo(earlier.at)}. Thanks!`
          }</p>`
        : ''
    }
  </div>`;
}

// ---------- Page ----------

function render() {
  miniMap?.remove();
  miniMap = null;
  document.title = `AccessLoop · ${report.title}`;
  main.innerHTML = `
    <a class="back-link" href="explore.html" data-back>${icon('back')}Back to reports</a>
    <div class="detail-layout">
      <article>
        <div class="detail-kicker">
          ${statusPill(report)}
          ${report.isSample ? '<span class="sample-label">Sample report</span>' : ''}
        </div>
        <div class="detail-title">${barrierIcon(report.category, { size: 32 })}<h1>${esc(report.title)}</h1></div>
        ${flagsHtml()}
        ${aboutHtml()}
        <section class="detail-section" aria-labelledby="status-history-title">
          <h2 id="status-history-title">Status history</h2>
          ${timelineHtml()}
        </section>
        ${locationHistoryHtml()}
        ${editHtml()}
      </article>
      <aside>
        ${responseHtml()}
        <div class="aside-note">
          <strong>Last confirmed ${timeAgo(report.lastConfirmedAt)}</strong>
          <p>Confirmations come from riders. Status updates come from the accessibility team.</p>
        </div>
      </aside>
    </div>`;
  drawMiniMap();
}

function drawMiniMap() {
  if (!document.getElementById('mini-map')) return;
  const location = report.location;
  miniMap = createBaseMap('mini-map', {
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    boxZoom: false,
    keyboard: false,
  }).setView(latLng(location), 16);
  L.marker(latLng(location), { icon: pinIcon(report.category), interactive: false, keyboard: false }).addTo(miniMap);
}

// ---------- Actions ----------

async function respond(value) {
  const option = report.category.responseOptions.find((o) => o.value === value);
  main.querySelectorAll('[data-response]').forEach((b) => (b.disabled = true));
  try {
    report = await api(`/reports/${report.id}/responses`, { method: 'POST', body: { value } });
    rememberResponse(report.id, value, option.label);
    ui.justVoted = true;
    ui.voteError = null;
  } catch (err) {
    ui.voteError = err.message;
  }
  render();
  main.querySelector('#response-title')?.focus();
}

async function saveEdit(form) {
  const editKey = form.editKey.value.trim();
  const errorBox = document.getElementById('edit-error');
  if (!editKey) {
    errorBox.innerHTML = '<p class="form-message" role="alert">Enter the edit key you saved when you reported this.</p>';
    return form.editKey.focus();
  }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    report = await api(`/reports/${report.id}`, {
      method: 'PUT',
      headers: { 'X-Edit-Key': editKey },
      body: { description: form.description.value.trim() || null },
    });
    Object.assign(ui, { editOpen: false, editError: null, editSaved: true });
    render();
    main.querySelector('#edit-title').scrollIntoView({ block: 'center' });
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Save changes';
    errorBox.innerHTML = `<p class="form-message" role="alert">${esc(err.message)}</p>`;
  }
}

main.addEventListener('click', (e) => {
  const back = e.target.closest('[data-back]');
  if (back && document.referrer.startsWith(window.location.origin) && history.length > 1) {
    e.preventDefault();
    history.back();
    return;
  }
  const button = e.target.closest('button');
  if (!button) return;
  if (button.dataset.response) respond(button.dataset.response);
  else if (button.dataset.action === 'edit') {
    Object.assign(ui, { editOpen: true, editSaved: false, editError: null });
    render();
    document.getElementById('edit-key').focus();
  } else if (button.dataset.action === 'cancel-edit') {
    ui.editOpen = false;
    render();
    main.querySelector('[data-action="edit"]').focus();
  } else if (button.dataset.retry !== undefined) load();
});

main.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'edit-form') saveEdit(e.target);
});

async function load() {
  if (!Number.isInteger(reportId) || reportId < 1) {
    main.innerHTML = `${errorMessage('This link is missing a report number', 'Find the barrier in Explore instead.', { retry: false })}
      <p><a class="text-link" href="explore.html">Go to Explore ${icon('arrow', 18)}</a></p>`;
    return;
  }
  main.innerHTML = loadingMessage('Loading this barrier…');
  try {
    report = await api(`/reports/${reportId}`);
    render();
  } catch (err) {
    main.innerHTML =
      err.status === 404
        ? `${errorMessage('This report doesn’t exist', 'It may have been removed by the accessibility team.', { retry: false })}
           <p><a class="text-link" href="explore.html">Go to Explore ${icon('arrow', 18)}</a></p>`
        : errorMessage('This barrier couldn’t load', err.message);
  }
}

load();
