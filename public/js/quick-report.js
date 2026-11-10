// Quick report pop-up: one page — where it is, what it is, anything else — then the edit key.
// Opens from the floating + Report button, a barrier's card, or a stop on your route, as a
// dialog over the dimmed map, so riders never leave the map or their route. The browser's
// <dialog> keeps keyboard focus inside it, closes it on Escape and announces it to screen readers.
// Riders aren't asked about severity anywhere: the barrier type sets it (see defaultSeverity in
// lib/rules.js), and only the accessibility team sees it, to sort their queue.
import { api } from './api.js';
import { esc, icon, barrierIcon, KIND_ORDER } from './ui.js';
import { createCombobox } from './combobox.js';

const stopKey = (name) => name.toLowerCase().replace(/\bstation\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// A stop from a planned route or the place search, which AccessLoop may not have saved yet.
// The server matches it to a saved stop nearby, or adds it, when the report is sent.
export const routeStop = ({ name, lat, lng, stopCode = null, mode = null, typeLabel = 'Stop on your route' }) => ({
  id: null,
  label: name,
  typeLabel,
  code: stopCode,
  place: { name, lat, lng, code: stopCode, mode },
});

export function createQuickReport({ root, button, getRouteStops, onSubmitted, onOpen }) {
  const state = {};
  let categories = null;
  let categoryError = null;

  // `preset` is a saved stop ({ id, label, … }) or a stop made with routeStop().
  function reset(preset) {
    Object.assign(state, {
      step: 'form',
      categoryId: null,
      location: preset ?? null,
      description: '',
      created: null,
      copied: false,
    });
  }

  async function open({ preset } = {}) {
    reset(preset);
    onOpen?.();
    if (!root.open) root.showModal();
    button.setAttribute('aria-expanded', 'true');
    render();
    // Start in the search, unless the stop is already known, or on a phone, where the keyboard
    // would pop up over the form before the rider has seen it.
    if (state.location || window.innerWidth <= 800) focusTitle();
    else root.querySelector('#qr-search')?.focus();
    if (!categories) {
      try {
        categories = await api('/categories');
      } catch (err) {
        categoryError = err.message;
      }
      const slot = root.querySelector('#qr-categories');
      if (slot) slot.innerHTML = categoriesHtml();
    }
  }

  function close() {
    button.setAttribute('aria-expanded', 'false');
    if (root.open) root.close(); // the 'close' listener below also covers Escape
  }

  const focusTitle = () => root.querySelector('h2')?.focus({ preventScroll: true });

  // ---------- The form ----------

  function categoriesHtml() {
    if (!categories) {
      return categoryError
        ? `<p class="form-message" role="alert">${esc(categoryError)}</p>`
        : '<p class="quick-loading">Loading barrier types…</p>';
    }
    const ordered = KIND_ORDER.flatMap((kind) => categories.filter((c) => c.kind === kind));
    return ordered
      .map(
        (c) => `<label class="quick-chip">
          <input type="radio" name="category" value="${c.id}"${state.categoryId === c.id ? ' checked' : ''}>
          ${barrierIcon(c, { size: 20 })}<span>${esc(c.name)}</span>
        </label>`,
      )
      .join('');
  }

  // Below the search: what to do, or which stop is chosen.
  function whereHelpHtml() {
    const l = state.location;
    if (!l) return 'Type a station, street or stop number, then choose it from the list.';
    return `${icon('check', 16)}<span>${esc(l.typeLabel ?? 'Stop')}${l.code ? ` · Stop ${esc(l.code)}` : ''}</span>`;
  }
  function updateWhereHelp() {
    const help = root.querySelector('#qr-where-help');
    if (!help) return;
    help.innerHTML = whereHelpHtml();
    help.classList.toggle('is-chosen', Boolean(state.location));
  }

  function formHtml() {
    return `<div class="quick-report-head">
        <div>
          <p class="eyebrow">Help other riders</p>
          <h2 id="quick-report-title" tabindex="-1">Report a barrier</h2>
        </div>
        <button type="button" data-action="close" aria-label="Close report">${icon('close')}</button>
      </div>
      <div class="safety-note">${icon('info')}<span>Only report when you’re safely stopped.</span></div>
      <form class="quick-report-form" id="quick-report-form" novalidate>
        <div class="quick-search quick-where">
          <label for="qr-search">Where is it?</label>
          <div class="inline-input">
            ${icon('search', 18)}
            <input id="qr-search" type="search" autocomplete="off" placeholder="Station, street or stop number"
              value="${esc(state.location?.label ?? '')}" required aria-describedby="qr-where-help"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="qr-search-results">
          </div>
          <ul class="journey-suggestions" id="qr-search-results" role="listbox" aria-label="Stops" hidden></ul>
          <p class="field-help quick-where-help${state.location ? ' is-chosen' : ''}" id="qr-where-help">${whereHelpHtml()}</p>
        </div>
        <fieldset class="quick-what">
          <legend>What’s the barrier?</legend>
          <div class="quick-category-grid" id="qr-categories">${categoriesHtml()}</div>
        </fieldset>
        <label for="qr-description">Anything else riders should know? <span>Optional</span></label>
        <textarea id="qr-description" name="description" rows="2" maxlength="1000" placeholder="For example: the north elevator works, use that one">${esc(state.description)}</textarea>
        <div id="qr-error"></div>
        <button class="button" type="submit">Send report</button>
        <p class="quick-privacy">Reports are public, so leave out names and private details. Need more room? Use the <a href="report.html">full report form</a>.</p>
      </form>`;
  }

  function doneHtml() {
    const { report, editKey } = state.created;
    return `<div class="quick-submitted">
      <div class="quick-report-head quick-done-head">
        <span></span>
        <button type="button" data-action="close" aria-label="Close report">${icon('close')}</button>
      </div>
      <div class="success-icon">${icon('check', 28)}</div>
      <h2 id="quick-report-title" tabindex="-1">Report sent</h2>
      <p>Thanks. You helped other riders know what’s happening here.</p>
      <div><strong>${esc(report.category.name)}</strong><span>${esc(report.location.label)}</span></div>
      <section class="key-card quick-key" aria-labelledby="qr-key-title">
        <h3 id="qr-key-title">Save your private edit key</h3>
        <p>It’s shown once. You need it to change the description while the report is still Reported.</p>
        <div class="key-row">
          <code id="qr-key">${esc(editKey)}</code>
          <button type="button" data-action="copy">${icon(state.copied === true ? 'check' : 'copy')}${state.copied === true ? 'Copied' : 'Copy'}</button>
        </div>
        <p class="key-help" role="status">${state.copied === 'selected' ? 'The key is selected. Press Ctrl+C (or ⌘C on a Mac) to copy it.' : ''}</p>
      </section>
      <button type="button" class="button" data-action="close">${getRouteStops() ? 'Back to your route' : 'Back to the map'}</button>
      <a class="text-link" href="barrier.html?id=${report.id}">View your report ${icon('arrow', 16)}</a>
    </div>`;
  }

  function render() {
    root.innerHTML = state.step === 'form' ? formHtml() : doneHtml();
    if (state.step === 'form') wireSearch();
  }

  // ---------- Stop search ----------
  // AccessLoop's saved stops come first; any other transit stop the trip planner knows comes
  // after, so riders can report at a stop nobody has reported before.

  async function searchStops(q) {
    const query = encodeURIComponent(q);
    const [saved, others] = await Promise.all([
      api(`/locations?q=${query}&limit=6`),
      api(`/places?q=${query}`).catch(() => []), // the trip planner may be unavailable
    ]);
    const known = new Set(saved.map((l) => stopKey(l.name)));
    const extra = others
      .filter((p) => p.type === 'STOP' && !known.has(stopKey(p.name)))
      .slice(0, 5)
      .map((p) => routeStop({ name: p.name, lat: p.lat, lng: p.lng, typeLabel: `Transit stop${p.area ? ` · ${p.area}` : ''}` }));
    return [...saved, ...extra];
  }

  function wireSearch() {
    createCombobox({
      input: root.querySelector('#qr-search'),
      list: root.querySelector('#qr-search-results'),
      idPrefix: 'qr-stop',
      search: searchStops,
      renderItem: (l) => `<span>${icon(l.type === 'SUBWAY_STATION' ? 'station' : 'location', 18)}</span>
        <span><strong>${esc(l.label)}</strong><small>${esc(l.typeLabel ?? 'Stop')}${l.code ? ` · Stop ${esc(l.code)}` : ''}</small></span>`,
      emptyText: 'No matching stops',
      onChoose: (l) => {
        state.location = l;
        root.querySelector('#qr-search').value = l.label;
        root.querySelector('#qr-error').innerHTML = '';
        updateWhereHelp();
        root.querySelector('input[name="category"]:checked, input[name="category"]')?.focus();
      },
    });
  }

  async function submit(form) {
    const errorBox = root.querySelector('#qr-error');
    const fail = (text, field) => {
      errorBox.innerHTML = `<p class="form-message" role="alert">${esc(text)}</p>`;
      field?.focus();
    };
    state.description = form.description.value;
    state.categoryId = Number(form.category?.value) || null;
    if (!state.location) return fail('Search for the stop, then choose it from the list.', root.querySelector('#qr-search'));
    if (!state.categoryId) return fail('Choose what the barrier is.', root.querySelector('input[name="category"]'));

    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Sending…';
    try {
      const where = state.location.id ? { locationId: state.location.id } : { place: state.location.place };
      state.created = await api('/reports', {
        method: 'POST',
        body: { categoryId: state.categoryId, ...where, description: state.description.trim() || null },
      });
      state.step = 'done';
      render();
      focusTitle();
      onSubmitted?.(state.created.report);
    } catch (err) {
      submitButton.disabled = false;
      submitButton.textContent = 'Send report';
      fail(err.message);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(state.created.editKey);
      state.copied = true;
    } catch {
      state.copied = 'selected';
    }
    render();
    root.querySelector('[data-action="copy"]').focus();
    if (state.copied === 'selected') {
      const range = document.createRange();
      range.selectNodeContents(root.querySelector('#qr-key'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
  }

  // ---------- Events ----------

  root.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    if (target.dataset.action === 'close') close();
    else if (target.dataset.action === 'copy') copyKey();
  });
  root.addEventListener('change', (e) => {
    if (e.target.name === 'category') {
      state.categoryId = Number(e.target.value);
      root.querySelector('#qr-error').innerHTML = '';
    }
  });
  root.addEventListener('input', (e) => {
    // Editing the stop's name after choosing it means a different stop is wanted.
    if (e.target.id === 'qr-search' && state.location && e.target.value !== state.location.label) {
      state.location = null;
      updateWhereHelp();
    }
    if (e.target.id === 'qr-description') state.description = e.target.value;
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.target);
  });
  // Runs however the dialog closes: the X, Escape, "Back to your route" or a click outside.
  root.addEventListener('close', () => {
    button.setAttribute('aria-expanded', 'false');
    // The browser returns focus to whatever opened the dialog; if that's gone, use the Report button.
    if (!document.activeElement || document.activeElement === document.body) button.focus();
  });
  // A click on the dimmed map closes the pop-up, unless that would throw away something:
  // a report being filled in, or the edit key that's only shown once.
  root.addEventListener('click', (e) => {
    if (e.target !== root) return;
    const box = root.getBoundingClientRect();
    const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
    const unsaved = state.step === 'done' || state.categoryId || state.description.trim();
    if (outside && !unsaved) close();
  });
  button.addEventListener('click', () => (root.open ? close() : open()));

  return { open, close, get isOpen() {
    return root.open;
  } };
}
