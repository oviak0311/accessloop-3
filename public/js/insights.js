// Insights: patterns worked out by the API from every stored report.
// Each chart can switch to a plain table with the same numbers.
import { api } from './api.js';
import {
  esc,
  KIND_COPY,
  formatDateTime,
  formatDuration,
  mountChrome,
  loadingMessage,
  errorMessage,
} from './ui.js';

mountChrome('insights');

const main = document.getElementById('main-content');
const monthName = (key) => new Date(`${key}-01T12:00:00`).toLocaleString('en-US', { month: 'short' });
const KIND_BADGE = { EQUIPMENT: ['E', 'equipment'], CONDITION: ['T', 'condition'], INFRASTRUCTURE: ['I', 'infra'] };

function summaryCard(label, value, note) {
  return `<article class="summary-card"><p>${label}</p><strong>${value}</strong><span>${note}</span></article>`;
}

function table(headers, rows) {
  return `<table>
    <thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

// A chart card with a "View as table" switch.
function chartCard(id, title, chart, tableHtml) {
  return `<section class="chart-card" aria-labelledby="${id}-title">
    <div class="chart-heading">
      <h2 id="${id}-title">${title}</h2>
      <button type="button" data-toggle="${id}" aria-controls="${id}-chart ${id}-table">View as table</button>
    </div>
    <div id="${id}-chart">${chart}</div>
    <div id="${id}-table" class="table-wrap" hidden>${tableHtml}</div>
  </section>`;
}

function render(data) {
  const { totals, byCategory, averageHoursToFix, recurringLocations, reportsPerMonth } = data;
  const openShare = totals.reports ? Math.round((totals.open / totals.reports) * 100) : 0;

  // Reports by barrier type
  const maxType = Math.max(1, ...byCategory.map((c) => c.reports));
  const typeChart = byCategory.length
    ? `<div class="bar-chart">${byCategory
        .map(
          (c) => `<div><span>${esc(c.name)}</span>
            <div><i style="width:${(c.reports / maxType) * 100}%"></i><strong>${c.reports}</strong></div></div>`,
        )
        .join('')}</div>`
    : '<p class="chart-empty">No reports yet.</p>';

  // Average time to fix, by kind
  const timeChart = `<div class="time-list">${averageHoursToFix.byKind
    .map((k) => {
      const d = formatDuration(k.hours);
      const [letter, cls] = KIND_BADGE[k.kind];
      return `<div>
        <span class="kind-icon ${cls}" aria-hidden="true">${letter}</span>
        <p>${KIND_COPY[k.kind].title}<small>${KIND_COPY[k.kind].examples}</small></p>
        <strong>${d ? `${d.value} <small>${d.unit}</small>` : '<small>No fixes yet</small>'}</strong>
      </div>`;
    })
    .join('')}</div>`;
  const overall = formatDuration(averageHoursToFix.overall);

  // Recurring locations
  const rankChart = recurringLocations.length
    ? `<ol class="rank-list">${recurringLocations
        .map(
          (l, i) => `<li><b aria-hidden="true">${i + 1}</b>
            <span>${esc(l.label)}<small>${esc(l.typeLabel)}${l.line ? ` · ${esc(l.line)}` : ''}</small></span>
            <strong>${l.reports} reports</strong></li>`,
        )
        .join('')}</ol>`
    : '<p class="chart-empty">No spot has more than one report yet.</p>';

  // Reports per month
  const maxMonth = Math.max(...reportsPerMonth.map((m) => m.reports));
  const peak = reportsPerMonth.reduce((a, b) => (b.reports > a.reports ? b : a), reportsPerMonth[0]);
  const monthChart = `<div class="monthly-chart" role="img"
      aria-label="Reports per month from ${monthName(reportsPerMonth[0].month)} to ${monthName(reportsPerMonth.at(-1).month)}. Busiest month: ${monthName(peak.month)} with ${peak.reports}.">
    ${reportsPerMonth
      .map(
        (m) => `<div><strong>${m.reports}</strong>
          <span style="height:${maxMonth ? (m.reports / maxMonth) * 100 : 0}%"></span>
          <small>${monthName(m.month)}</small></div>`,
      )
      .join('')}
  </div>`;

  main.innerHTML = `
    <p class="eyebrow">Patterns in the logbook</p>
    <h1>Accessibility insights</h1>
    <p class="lede">A clear view of recurring barriers and how long they take to resolve.</p>
    <p class="updated">Updated ${formatDateTime(data.generatedAt)}${
      totals.sample ? ` · Includes ${totals.sample} sample reports` : ''
    } · Duplicate reports aren’t counted</p>
    <div class="summary-grid">
      ${summaryCard('Total reports', totals.reports, 'Every report in the logbook')}
      ${summaryCard('Open', totals.open, `${openShare}% of all reports`)}
      ${summaryCard('Fixed', totals.fixed, 'Resolved, cleared or built')}
      ${summaryCard('Closed without a fix', totals.closedWithoutFix, 'Not planned or couldn’t verify')}
    </div>
    <div class="insight-grid">
      ${chartCard(
        'types',
        'Reports by barrier type',
        typeChart,
        table(['Barrier type', 'Reports'], byCategory.map((c) => [c.name, c.reports])),
      )}
      ${chartCard(
        'fix-time',
        'Average time to fix',
        `${timeChart}${overall ? `<p class="chart-empty">Across all kinds: ${overall.value} ${overall.unit}.</p>` : ''}`,
        table(
          ['Barrier kind', 'Average time to fix', 'Fixed reports'],
          averageHoursToFix.byKind.map((k) => {
            const d = formatDuration(k.hours);
            return [KIND_COPY[k.kind].title, d ? `${d.value} ${d.unit}` : 'No fixes yet', k.fixed];
          }),
        ),
      )}
      ${chartCard(
        'recurring',
        'Locations with recurring barriers',
        rankChart,
        table(['Location', 'Reports'], recurringLocations.map((l) => [l.label, l.reports])),
      )}
      ${chartCard(
        'monthly',
        'Reports per month',
        monthChart,
        table(['Month', 'Reports'], reportsPerMonth.map((m) => [`${monthName(m.month)} ${m.month.slice(0, 4)}`, m.reports])),
      )}
    </div>`;
}

main.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const id = toggle.dataset.toggle;
    const showTable = document.getElementById(`${id}-table`).hidden;
    document.getElementById(`${id}-table`).hidden = !showTable;
    document.getElementById(`${id}-chart`).hidden = showTable;
    toggle.textContent = showTable ? 'Show chart' : 'View as table';
  } else if (e.target.closest('[data-retry]')) {
    load();
  }
});

async function load() {
  main.innerHTML = loadingMessage('Loading insights…');
  try {
    render(await api('/insights'));
  } catch (err) {
    main.innerHTML = errorMessage('Insights couldn’t load', err.message);
  }
}

load();
