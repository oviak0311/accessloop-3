// Admin: the accessibility team reviews reports, moves them through their statuses,
// marks duplicates and deletes spam. Every request sends the team passcode.
import { api } from './api.js';
import {
  esc,
  icon,
  statusPill,
  severityMark,
  timeAgo,
  formatDateTime,
  mountChrome,
  loadingMessage,
  errorMessage,
} from './ui.js';

mountChrome(null);

const main = document.getElementById('main-content');
const PASSCODE_KEY = 'accessloop-admin-passcode';
const NOTE_REQUIRED = ['NOT_PLANNED', 'COULD_NOT_VERIFY']; // same rule as the server
const narrow = window.matchMedia('(max-width: 800px)');

const state = {
  passcode: readPasscode(),
  view: 'attention',
  lists: { attention: [], open: [] },
  selectedId: null,
  history: null, // status history of the selected report
  message: null, // { text, type }
  deleteConfirm: false,
};

// The passcode is kept for this tab only, and cleared on Lock admin or when the tab closes.
function readPasscode() {
  try {
    return sessionStorage.getItem(PASSCODE_KEY) || '';
  } catch {
    return '';
  }
}
function savePasscode(value) {
  try {
    if (value) sessionStorage.setItem(PASSCODE_KEY, value);
    else sessionStorage.removeItem(PASSCODE_KEY);
  } catch {
    // Storage blocked: the passcode simply isn't remembered between page loads.
  }
}

function adminApi(path, options = {}) {
  return api(`/admin${path}`, { ...options, headers: { 'X-Admin-Passcode': state.passcode } });
}

const currentList = () => state.lists[state.view];
const selected = () => currentList().find((r) => r.id === state.selectedId) ?? null;
const tagClass = (reason) => (reason.startsWith('Riders say') ? 'attention-tag rider' : 'attention-tag');
const tags = (r) =>
  r.attentionReasons.length
    ? `<span class="attention-tags">${r.attentionReasons.map((t) => `<span class="${tagClass(t)}">${esc(t)}</span>`).join('')}</span>`
    : '<span></span>';

// ---------- Login ----------

function renderLogin(error = '') {
  main.className = 'admin-login';
  main.innerHTML = `
    <div class="admin-lock"><span class="brand-mark"><span></span></span></div>
    <p class="eyebrow">Accessibility team</p>
    <h1>Admin access</h1>
    <p>Enter the team passcode to review and update reports.</p>
    <form id="login-form" novalidate>
      <label for="passcode">Team passcode</label>
      <input id="passcode" name="passcode" type="password" autocomplete="current-password" required
        placeholder="Enter passcode"${error ? ' aria-invalid="true" aria-describedby="login-error"' : ''}>
      ${error ? `<p class="form-message" id="login-error" role="alert">${esc(error)}</p>` : ''}
      <button class="button" type="submit">Continue ${icon('arrow')}</button>
    </form>
    <p class="admin-help">The passcode stays in this browser tab and is cleared when you close it or lock admin.</p>`;
  main.querySelector('#passcode').focus();
}

function lock(error = '') {
  savePasscode('');
  Object.assign(state, { passcode: '', selectedId: null, history: null, message: null, deleteConfirm: false });
  renderLogin(error);
}

async function login(form) {
  const passcode = form.passcode.value.trim();
  if (!passcode) return renderLogin('Enter the team passcode.');
  state.passcode = passcode;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Checking…';
  if (await loadLists()) {
    savePasscode(passcode);
    renderDashboard();
  }
}

// ---------- Data ----------

// Returns true if the lists loaded. A wrong passcode sends the user back to the login.
async function loadLists() {
  try {
    const [attention, open] = await Promise.all([adminApi('/reports?view=attention'), adminApi('/reports?view=open')]);
    state.lists = { attention: attention.reports, open: open.reports };
    if (!selected()) state.selectedId = currentList()[0]?.id ?? null;
    return true;
  } catch (err) {
    if (err.status === 401) lock('That passcode didn’t work. Try again.');
    else {
      main.className = 'admin-page';
      main.innerHTML = errorMessage('Reports couldn’t load', err.message);
    }
    return false;
  }
}

async function loadHistory(id) {
  state.history = null;
  try {
    const detail = await api(`/reports/${id}`);
    if (state.selectedId !== id) return;
    state.history = detail.history;
  } catch {
    state.history = [];
  }
  const box = document.getElementById('review-history');
  if (box) box.innerHTML = historyHtml();
}

// ---------- Dashboard ----------

function renderDashboard({ focusReview = false } = {}) {
  main.className = 'admin-page';
  const list = currentList();
  const tab = (view, label) =>
    `<button type="button" role="tab" id="tab-${view}" data-view="${view}" aria-controls="queue-list"
      aria-selected="${state.view === view}" tabindex="${state.view === view ? 0 : -1}">${label} (${state.lists[view].length})</button>`;

  main.innerHTML = `
    <div class="admin-heading">
      <div>
        <p class="eyebrow">Accessibility team</p>
        <h1>${state.view === 'attention' ? 'Needs attention' : 'All open reports'}</h1>
        <p>${state.view === 'attention' ? 'Reports flagged by riders or the system.' : 'Every report that is still open.'}</p>
      </div>
      <button class="secondary-button" type="button" data-action="lock">Lock admin</button>
    </div>
    <div id="admin-message" role="status">${
      state.message ? `<p class="form-message ${state.message.type}">${esc(state.message.text)}</p>` : ''
    }</div>
    <div class="admin-layout">
      <section class="admin-queue" aria-label="Report queue">
        <div class="queue-tabs" role="tablist" aria-label="Queue">
          ${tab('attention', 'Needs attention')}${tab('open', 'All open')}
        </div>
        <div class="queue-title"><h2>${list.length} ${list.length === 1 ? 'report' : 'reports'}</h2><span>Most urgent first</span></div>
        <div id="queue-list" role="tabpanel" aria-labelledby="tab-${state.view}">
          ${
            list.length
              ? list
                  .map(
                    (r) => `<button type="button" class="queue-item${r.id === state.selectedId ? ' active' : ''}" data-select="${r.id}"
                      ${r.id === state.selectedId ? 'aria-current="true"' : ''}>
                      <div>${tags(r)}<small>${timeAgo(r.createdAt)}</small></div>
                      <strong>${esc(r.title)}</strong>
                      <span>${statusPill(r)}${severityMark(r)}</span>
                    </button>`,
                  )
                  .join('')
              : `<p class="queue-empty">${state.view === 'attention' ? 'Nothing needs attention right now.' : 'No open reports.'}</p>`
          }
        </div>
      </section>
      <section class="review-panel" id="review-panel" aria-label="Selected report">${reviewHtml()}</section>
    </div>`;

  if (focusReview) {
    const title = document.getElementById('review-title');
    if (narrow.matches) title?.scrollIntoView({ block: 'start' });
    title?.focus({ preventScroll: !narrow.matches });
  }
}

function historyHtml() {
  if (!state.history) return loadingMessage('Loading history…');
  if (!state.history.length) return '<p class="field-help">No history found.</p>';
  return `<ol class="review-history">${state.history
    .map(
      (h) => `<li><strong>${esc(h.newStatusLabel)}</strong><small>${formatDateTime(h.createdAt)}</small>
        ${h.note ? `<p>${esc(h.note)}</p>` : ''}</li>`,
    )
    .join('')}</ol>`;
}

function reviewHtml() {
  const r = selected();
  if (!r) return '<p class="review-empty">Choose a report from the queue to review it.</p>';
  const [still, gone] = r.category.responseOptions;
  const originals = state.lists.open
    .filter((o) => o.id !== r.id)
    .sort((a, b) => (b.location.id === r.location.id) - (a.location.id === r.location.id) || a.id - b.id);

  return `
    <div class="review-head">
      <div>
        ${tags(r)}
        <h2 id="review-title" tabindex="-1">${esc(r.title)}</h2>
        <p>${r.description ? esc(r.description) : 'No description was added.'}</p>
      </div>
      <a class="icon-button" href="barrier.html?id=${r.id}" target="_blank" rel="noopener"
        aria-label="Open the public page for this report in a new tab">${icon('external')}</a>
    </div>
    <dl class="review-meta">
      <div><dt>Current status</dt><dd>${statusPill(r)}</dd></div>
      <div><dt>Severity</dt><dd>${severityMark(r)}</dd></div>
      <div><dt>Last confirmed</dt><dd>${timeAgo(r.lastConfirmedAt)}</dd></div>
    </dl>
    <p class="review-responses">Rider responses: ${esc(still.label)} ${r.responseCounts[still.value] ?? 0} ·
      ${esc(gone.label)} ${r.responseCounts[gone.value] ?? 0}${r.isSample ? ' · Sample report' : ''}</p>
    <h3 class="review-history-title">Status history</h3>
    <div id="review-history">${historyHtml()}</div>

    <form class="update-form" id="update-form" novalidate>
      <h3>Update this report</h3>
      <label for="status-update">Next status</label>
      <select id="status-update" name="status" required>
        <option value="">Choose a status</option>
        ${r.allowedNextStatuses.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}
      </select>
      <div id="duplicate-field" hidden>
        <label for="original">Original report</label>
        ${
          originals.length
            ? `<select id="original" name="duplicateOfId">
                <option value="">Choose the original report</option>
                ${originals
                  .map(
                    (o) => `<option value="${o.id}">#${o.id} · ${esc(o.title)}${o.location.id === r.location.id ? ' (same spot)' : ''}</option>`,
                  )
                  .join('')}
              </select>`
            : '<p class="field-help">There are no other open reports to choose from.</p>'
        }
      </div>
      <label for="admin-note">Update note <strong id="note-required" hidden>Required</strong></label>
      <textarea id="admin-note" name="note" maxlength="500" placeholder="Add a plain-language note for riders"></textarea>
      <p class="field-help">This note will appear in the public status history.</p>
      <div id="update-error"></div>
      <button class="button" type="submit">Save update</button>
    </form>

    <div class="danger-zone">
      <div>
        <h3>Delete report</h3>
        <p>Only delete spam or harmful content. This cannot be undone.</p>
      </div>
      ${
        state.deleteConfirm
          ? `<div class="confirm-delete" role="group" aria-label="Confirm delete">
              <strong>Delete this report?</strong>
              <button type="button" data-action="delete">Yes, delete</button>
              <button type="button" data-action="cancel-delete">Cancel</button>
            </div>`
          : `<button class="delete-button" type="button" data-action="ask-delete">${icon('trash', 18)}Delete</button>`
      }
    </div>`;
}

// ---------- Actions ----------

function select(id, { focusReview = true } = {}) {
  state.selectedId = id;
  state.deleteConfirm = false;
  renderDashboard({ focusReview });
  if (id) loadHistory(id);
}

async function refreshAfterChange(message) {
  state.message = message;
  if (await loadLists()) {
    renderDashboard();
    if (state.selectedId) loadHistory(state.selectedId);
    document.getElementById('admin-message').scrollIntoView({ block: 'center' });
  }
}

async function saveStatus(form) {
  const r = selected();
  const status = form.status.value;
  const note = form.note.value.trim();
  const duplicateOfId = form.duplicateOfId?.value;
  const errorBox = document.getElementById('update-error');
  const fail = (text, field) => {
    errorBox.innerHTML = `<p class="form-message" role="alert">${esc(text)}</p>`;
    field?.focus();
  };

  if (!status) return fail('Choose the next status.', form.status);
  if (status === 'DUPLICATE' && !duplicateOfId) return fail('Choose the original report.', form.duplicateOfId ?? form.status);
  if (NOTE_REQUIRED.includes(status) && !note) return fail('Add a note so riders know why.', form.note);

  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const updated = await adminApi(`/reports/${r.id}/status`, {
      method: 'PATCH',
      body: { status, note: note || undefined, duplicateOfId: status === 'DUPLICATE' ? Number(duplicateOfId) : undefined },
    });
    await refreshAfterChange({ type: 'success', text: `“${updated.title}” is now ${updated.statusLabel}.` });
  } catch (err) {
    if (err.status === 401) return lock('Your passcode no longer works. Enter it again.');
    button.disabled = false;
    button.textContent = 'Save update';
    fail(err.message);
  }
}

async function deleteSelected() {
  const r = selected();
  try {
    await adminApi(`/reports/${r.id}`, { method: 'DELETE' });
    state.selectedId = null;
    state.deleteConfirm = false;
    await refreshAfterChange({ type: 'success', text: `Deleted “${r.title}” with its history and responses.` });
  } catch (err) {
    if (err.status === 401) return lock('Your passcode no longer works. Enter it again.');
    state.deleteConfirm = false;
    state.message = { type: 'error', text: err.message };
    renderDashboard();
  }
}

main.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'login-form') login(e.target);
  else if (e.target.id === 'update-form') saveStatus(e.target);
});

main.addEventListener('change', (e) => {
  if (e.target.id !== 'status-update') return;
  const status = e.target.value;
  document.getElementById('duplicate-field').hidden = status !== 'DUPLICATE';
  document.getElementById('note-required').hidden = !NOTE_REQUIRED.includes(status);
  document.getElementById('admin-note').required = NOTE_REQUIRED.includes(status);
  document.getElementById('update-error').innerHTML = '';
});

main.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.dataset.select) {
    state.message = null;
    select(Number(button.dataset.select));
  } else if (button.dataset.view) {
    state.view = button.dataset.view;
    state.message = null;
    select(selected()?.id ?? currentList()[0]?.id ?? null, { focusReview: false });
    document.getElementById(`tab-${state.view}`).focus();
  } else if (button.dataset.action === 'lock') lock();
  else if (button.dataset.action === 'ask-delete') {
    state.deleteConfirm = true;
    renderDashboard();
    main.querySelector('[data-action="cancel-delete"]').focus();
  } else if (button.dataset.action === 'cancel-delete') {
    state.deleteConfirm = false;
    renderDashboard();
    main.querySelector('[data-action="ask-delete"]').focus();
  } else if (button.dataset.action === 'delete') deleteSelected();
  else if (button.dataset.retry !== undefined) start();
});

// Arrow keys move between the two queue tabs.
main.addEventListener('keydown', (e) => {
  if (!e.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  main.querySelector(`[role="tab"]:not([aria-selected="true"])`).click();
});

async function start() {
  if (!state.passcode) return renderLogin();
  main.className = 'admin-page';
  main.innerHTML = loadingMessage('Loading reports…');
  if (await loadLists()) {
    renderDashboard();
    if (state.selectedId) loadHistory(state.selectedId);
  }
}

start();
