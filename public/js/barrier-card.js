// A barrier's details, shown when a pin or list item is chosen: status, flags, the
// "Still there?" answers and links onward. On a computer it sits in a card on the pin
// (pin-card.js); on a phone, in the bottom sheet. Used by the home map and Explore.
import { api } from './api.js';
import {
  esc,
  icon,
  barrierIcon,
  statusPill,
  reportFlags,
  timeAgo,
  recentResponse,
  rememberResponse,
} from './ui.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// view: { reports, index, answered, error }
export function barrierCardHtml(view, { planLink = true } = {}) {
  const report = view.reports[view.index];
  const [still, gone] = report.category.responseOptions;
  const confirmed = report.responseCounts?.[still.value] ?? 0;
  const flags = reportFlags(report);
  const earlier = recentResponse(report.id);
  const l = report.location;

  let answers;
  if (!report.isOpen) {
    answers = `<div class="pin-thanks is-repeat">${icon('check')}<div><strong>Report closed: ${esc(report.statusLabel)}</strong>
      <span>This report no longer takes rider updates.</span></div></div>`;
  } else if (view.answered === report.id) {
    answers = `<div class="pin-thanks" role="status">${icon('check')}<div><strong>Thanks for the update!</strong>
      <span>You just helped other riders plan their trip.</span></div></div>`;
  } else if (earlier) {
    answers = `<div class="pin-thanks is-repeat">${icon('check')}<div><strong>You updated this ${timeAgo(earlier.at)}</strong>
      <span>You said “${esc(earlier.label)}”. Thanks for helping other riders.</span></div></div>`;
  } else {
    answers = `${view.error ? `<p class="form-message" role="alert">${esc(view.error)}</p>` : ''}
      <div class="pin-responses">
        <button type="button" class="pin-yes" data-response="${still.value}">${icon('eye')}${esc(still.label)}</button>
        <button type="button" class="pin-no" data-response="${gone.value}">${icon('check')}${esc(gone.label)}</button>
      </div>`;
  }

  return `<article class="barrier-view" aria-labelledby="barrier-view-title">
    <div class="barrier-view-main">
      <div class="pin-card-title">
        ${barrierIcon(report.category, { size: 27 })}
        <div>
          <p>${report.isOpen ? 'Still there?' : 'Past report'}</p>
          <h2 id="barrier-view-title" tabindex="-1">${esc(report.title)}</h2>
        </div>
      </div>
      ${
        view.reports.length > 1
          ? `<div class="pin-card-switch">
              <span>Report ${view.index + 1} of ${view.reports.length} here</span>
              <div>
                <button type="button" data-step="-1" aria-label="Previous report"${view.index === 0 ? ' disabled' : ''}>${icon('back', 18)}</button>
                <button type="button" data-step="1" aria-label="Next report"${view.index === view.reports.length - 1 ? ' disabled' : ''}>${icon('chevron', 18)}</button>
              </div>
            </div>`
          : ''
      }
      <div class="pin-card-meta">${statusPill(report)}</div>
      <p class="pin-friendly">Reported ${timeAgo(report.createdAt)} · ${
        confirmed ? `${plural(confirmed, 'rider')} confirmed` : 'No confirmations yet'
      }${report.isSample ? ' · Sample' : ''}</p>
      ${flags.map((f) => `<div class="flag">${icon('info', 18)}<strong>${esc(f)}</strong></div>`).join('')}
    </div>
    <div class="barrier-view-side">
      ${answers}
      <div class="barrier-view-links">
        <a class="text-link" href="barrier.html?id=${report.id}">Full report ${icon('arrow', 16)}</a>
        <button type="button" class="text-link" data-action="report-here" data-location="${l.id}">Report something else here</button>
        ${
          planLink && l.latitude != null
            ? `<button type="button" class="text-link" data-action="plan-here" data-location="${l.id}">Plan a trip here</button>`
            : ''
        }
      </div>
    </div>
  </article>`;
}

// Saves a rider's "Still there?" answer and returns the updated report.
export async function saveResponse(report, value) {
  const option = report.category.responseOptions.find((o) => o.value === value);
  const updated = await api(`/reports/${report.id}/responses`, { method: 'POST', body: { value } });
  rememberResponse(report.id, value, option.label);
  return updated;
}
