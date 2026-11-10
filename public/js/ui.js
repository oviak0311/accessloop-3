// Shared front-end helpers: icons, labels, dates, the header and footer.
// Every page imports what it needs from here.

// Escapes text before it goes into HTML, so rider-written text can't inject markup.
export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ---------- Icons (24px line icons from the design) ----------

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  location: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  station: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l-2-4M15 21l2-4M9 13.5h.01M15 13.5h.01"/>',
  elevator: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3"/>',
  escalator: '<circle cx="7" cy="5" r="1.5"/><path d="M7 8v5h3l3 4h5M4 19h6l5-8h5"/>',
  door: '<path d="M5 21V3h13v18M9 3v18"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
  intercom: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M9.5 15h5M9.5 18h5"/>',
  snow: '<path d="M12 2v20M4 7l16 10M20 7 4 17M9 4l3 3 3-3M9 20l3-3 3 3"/>',
  water: '<path d="M12 3s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z"/>',
  cone: '<path d="m9 4-4 16h14L15 4Z"/><path d="M7 12h10M4 20h16"/>',
  shelter: '<path d="M4 21V8l8-5 8 5v13M7 12h10M8 21v-6h8v6"/>',
  bench: '<path d="M5 11h14v5H5zM7 16v5M17 16v5M6 7h12v4"/>',
  light: '<path d="M9 18h6M10 22h4M8 14a6 6 0 1 1 8 0c-1 .8-1 2-1 2H9s0-1.2-1-2Z"/>',
  walk: '<circle cx="14" cy="4" r="2"/><path d="m10 21 2-7-3-3 2-4 4 3 3 1M7 21l3-6M15 21l-3-7"/>',
  bus: '<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M8 19v2M16 19v2M8 7h8"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',
  tram: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3h6M12 3v3M6 12h12M9 18l-2 3M15 18l2 3M9.5 15h.01M14.5 15h.01"/>',
  wheelchair: '<circle cx="10" cy="4" r="2"/><path d="M10 7v6h5l3 5M10 10H7M9 13a5 5 0 1 0 5 5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
  expand: '<path d="m6 15 6-6 6 6"/>',
  swap: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  warning: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
};

export function icon(name, size = 20) {
  return `<svg aria-hidden="true" focusable="false" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] ?? ICON_PATHS.info}</svg>`;
}

// Fills <span data-icon="search" data-size="23"></span> placeholders in a page's HTML.
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.outerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 20);
  }
}

// Picks an icon from the barrier type's name.
export function iconForCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('elevator')) return 'elevator';
  if (n.includes('escalator')) return 'escalator';
  if (n.includes('intercom')) return 'intercom';
  if (n.includes('door') || n.includes('entrance')) return 'door';
  if (n.includes('ice') || n.includes('snow')) return 'snow';
  if (n.includes('flood')) return 'water';
  if (n.includes('construction')) return 'cone';
  if (n.includes('shelter')) return 'shelter';
  if (n.includes('bench')) return 'bench';
  if (n.includes('light')) return 'light';
  return 'info';
}

// The coloured barrier badge. Colour shows the kind; the icon shows the type.
export function barrierIcon(category, { size = 24, count } = {}) {
  const name = iconForCategory(category.name);
  const badge = count > 1 ? `<b>${count}</b>` : '';
  return `<span class="barrier-icon barrier-icon-${name} kind-${category.kind.toLowerCase()}" aria-hidden="true">${icon(name, size)}${badge}</span>`;
}

export function placeIcon(location) {
  return `<span class="place-icon" aria-hidden="true">${icon(location.type === 'SUBWAY_STATION' ? 'station' : 'location', 20)}</span>`;
}

// ---------- Labels ----------

export const KIND_COPY = {
  EQUIPMENT: {
    title: 'Broken equipment',
    hint: 'Things that should be working',
    short: 'Equipment',
    examples: 'Elevators, escalators, doors',
  },
  CONDITION: {
    title: 'Temporary condition',
    hint: 'Something blocking access today',
    short: 'Condition',
    examples: 'Ice, flooding, construction',
  },
  INFRASTRUCTURE: {
    title: 'Missing infrastructure',
    hint: 'Features this stop needs',
    short: 'Missing',
    examples: 'Shelters, benches, lighting',
  },
};
export const KIND_ORDER = ['EQUIPMENT', 'CONDITION', 'INFRASTRUCTURE'];

export const SEVERITY_COPY = {
  LOW: { label: 'Low', hint: 'Minor difficulty' },
  MEDIUM: { label: 'Medium', hint: 'Hard to use' },
  HIGH: { label: 'High', hint: 'No access' },
};
const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// Same labels and paths as lib/rules.js on the server (the server enforces them).
export const STATUS_LABELS = {
  REPORTED: 'Reported',
  UNDER_REVIEW: 'Under review',
  IN_PROGRESS: 'In progress',
  ACKNOWLEDGED: 'Acknowledged',
  PLANNED: 'Planned',
  RESOLVED: 'Resolved',
  CLEARED: 'Cleared',
  BUILT: 'Built',
  NOT_PLANNED: 'Not planned',
  DUPLICATE: 'Duplicate',
  COULD_NOT_VERIFY: 'Couldn’t verify',
};
export const STATUS_PATHS = {
  EQUIPMENT: ['REPORTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED'],
  CONDITION: ['REPORTED', 'CLEARED'],
  INFRASTRUCTURE: ['REPORTED', 'ACKNOWLEDGED', 'PLANNED', 'BUILT'],
};

// Most severe first, then newest first.
export function byUrgency(a, b) {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || new Date(b.createdAt) - new Date(a.createdAt);
}

export function statusPill(report) {
  const key = report.status.toLowerCase().replace(/_/g, '-');
  return `<span class="status status-${key}">${esc(report.statusLabel)}</span>`;
}

export function severityMark(report) {
  return `<span class="severity severity-${report.severity.toLowerCase()}"><span class="severity-dot"></span>${esc(report.severityLabel)} severity</span>`;
}

// The notices the API works out: riders say it's gone, or it may have cleared.
export function reportFlags(report) {
  const flags = [];
  if (report.riderSays) flags.push(report.riderSays);
  if (report.mayHaveCleared) flags.push('May have cleared');
  return flags;
}

// ---------- Dates ----------

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

export function timeAgo(value) {
  const seconds = Math.round((new Date(value) - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s);
  return relative.format(Math.round(seconds / size), unit);
}

export function formatDateTime(value) {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDuration(hours) {
  if (hours === null || hours === undefined) return null;
  if (hours < 48) return { value: Math.round(hours * 10) / 10, unit: hours === 1 ? 'hour' : 'hours' };
  return { value: Math.round((hours / 24) * 10) / 10, unit: 'days' };
}

// ---------- Distance (for "Use my location"; nothing is sent to the server) ----------

export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function formatKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Makes search forgiving: "bloor yonge" matches "Bloor–Yonge".
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Rider responses remembered in this browser ----------
// Stops a rider from answering the same barrier twice by accident.
// Saved only in this browser, never sent anywhere.

const RESPONSES_KEY = 'accessloop-responses';
const REMEMBER_HOURS = 12;

function readResponses() {
  try {
    return JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  } catch {
    return {};
  }
}

export function recentResponse(reportId) {
  const entry = readResponses()[reportId];
  return entry && Date.now() - entry.at < REMEMBER_HOURS * 3600 * 1000 ? entry : null;
}

export function rememberResponse(reportId, value, label) {
  const all = readResponses();
  const cutoff = Date.now() - REMEMBER_HOURS * 3600 * 1000;
  for (const id of Object.keys(all)) if (all[id].at < cutoff) delete all[id];
  all[reportId] = { value, label, at: Date.now() };
  try {
    localStorage.setItem(RESPONSES_KEY, JSON.stringify(all));
  } catch {
    // Storage can be blocked (private mode). The response was still saved on the server.
  }
}

// ---------- Page pieces ----------

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function loadingMessage(text) {
  return `<div class="state-message" role="status"><span class="loading-dot" aria-hidden="true"></span>${esc(text)}</div>`;
}

export function errorMessage(title, text, { retry = true } = {}) {
  return `<div class="state-message" role="alert">
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
    ${retry ? '<button type="button" class="secondary-button" data-retry>Try again</button>' : ''}
  </div>`;
}

// Main navigation. Insights is linked from Explore and the footer instead, to keep this short.
const NAV = [
  { key: 'home', label: 'Map', href: 'index.html' },
  { key: 'explore', label: 'Explore', href: 'explore.html' },
];

const brand = (extraClass = '') =>
  `<a class="brand ${extraClass}" href="index.html"><span class="brand-mark"><span></span></span>AccessLoop</a>`;

// The map pages fill the screen like a maps app, so their footer links sit at the end of the
// bottom sheet instead of below the map.
export const sheetLinksHtml = () => `
  <nav class="sheet-links" aria-label="More from AccessLoop">
    <a href="insights.html">Insights</a>
    <a href="report.html">Full report form</a>
    <a href="admin.html">Accessibility team</a>
    <a href="https://github.com/oviak0311/accessloop">Source code</a>
    <span>An independent shared logbook, not an official transit service.</span>
  </nav>`;

// Fills in the shared header and footer. `active` is the current page's nav key.
export function mountChrome(active) {
  const header = document.querySelector('.site-header');
  header.innerHTML = `
    <div class="header-inner">
      ${brand()}
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open navigation">${icon('menu', 26)}</button>
      <nav id="site-nav" class="nav" aria-label="Main navigation">
        <span class="nav-tabs">${NAV.map((l) => `<a href="${l.href}"${l.key === active ? ' aria-current="page"' : ''}>${l.label}</a>`).join('')}</span>
        ${
          // The map pages have their own floating + Report button, so the header doesn't repeat it.
          document.getElementById('report-button')
            ? ''
            : `<a class="button button-small" href="index.html?report=1"${active === 'report' ? ' aria-current="page"' : ''}>${icon('plus', 18)}Report a barrier</a>`
        }
      </nav>
    </div>`;

  const menuButton = header.querySelector('.menu-button');
  const nav = header.querySelector('.nav');
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    menuButton.innerHTML = icon(open ? 'close' : 'menu', 26);
  };
  menuButton.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      setOpen(false);
      menuButton.focus();
    }
  });

  const footer = document.querySelector('footer');
  if (footer) {
    footer.innerHTML = `
      <div>
        ${brand('footer-brand')}
        <p>An independent shared logbook for a more accessible trip.</p>
      </div>
      <nav aria-label="Footer navigation">
        ${NAV.map((l) => `<a href="${l.href}">${l.label}</a>`).join('')}
        <a href="insights.html">Insights</a>
        <a href="report.html">Full report form</a>
        <a href="admin.html">Accessibility team</a>
        <a href="https://github.com/oviak0311/accessloop">Source code</a>
      </nav>`;
  }
  fillIcons();
}
