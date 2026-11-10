// Results panel over the map, like a maps app. On phones it's a bottom sheet: "peek" shows just
// its bar, "half" shows the content, "full" fills most of the screen; press the bar, use the
// expand button or drag the bar. On desktop the same panel is a floating card on the left
// (styled in CSS): pressing its bar folds it away ("peek") or opens it again.
const PEEK = 64;

export function createSheet(root, { onChange, footer = '' } = {}) {
  const app = root.closest('.app-map');
  const bar = root.querySelector('.sheet-bar');
  const handle = root.querySelector('.sheet-handle');
  const expand = root.querySelector('.sheet-expand');
  const title = root.querySelector('.sheet-title');
  const body = root.querySelector('.sheet-body');
  let state = root.dataset.state || 'peek';
  let hidden = root.hidden; // a hidden panel takes no room, so the map fills the screen
  let drag = null;
  let ignoreClick = false;

  // Heights are worked out from the map's size, and shared with the page as CSS variables
  // so the report button and map controls can sit just above the sheet.
  function heights() {
    const room = app.clientHeight;
    const phone = window.innerWidth <= 800;
    return { peek: PEEK, half: Math.round(Math.min(phone ? room * 0.5 : 360, room - 120)), full: Math.round(room - (phone ? 70 : 100)) };
  }
  function applyHeights() {
    const h = heights();
    app.style.setProperty('--sheet-half', `${h.half}px`);
    app.style.setProperty('--sheet-full', `${h.full}px`);
    app.style.setProperty('--sheet-now', hidden ? '0px' : `${h[state]}px`);
  }

  // Shows the panel at a size: "peek", "half" or "full".
  function set(next) {
    hidden = false;
    root.hidden = false;
    apply(next);
  }
  function apply(next) {
    state = next;
    root.dataset.state = next;
    app.dataset.sheet = hidden ? 'hidden' : next;
    const open = next !== 'peek';
    handle.setAttribute('aria-expanded', String(open));
    expand.hidden = !open;
    expand.setAttribute('aria-label', next === 'full' ? 'Make the panel smaller' : 'Make the panel bigger');
    expand.classList.toggle('is-full', next === 'full');
    body.inert = !open; // closed content can't be reached by keyboard or screen readers
    applyHeights();
    onChange?.(next);
  }

  handle.addEventListener('click', () => {
    if (ignoreClick) return void (ignoreClick = false);
    set(state === 'peek' ? 'half' : 'peek');
  });
  expand.addEventListener('click', () => set(state === 'full' ? 'half' : 'full'));

  // Dragging the bar resizes the sheet; letting go snaps to the nearest size.
  // Movement is followed on the whole window, so the drag keeps working when the finger leaves the bar.
  const onMove = (e) => {
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    root.classList.add('is-dragging');
    const h = heights();
    root.style.height = `${Math.max(h.peek, Math.min(h.full, drag.startHeight - dy))}px`;
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (drag?.moved) {
      const now = root.offsetHeight;
      const h = heights();
      const nearest = Object.entries(h).sort((a, b) => Math.abs(a[1] - now) - Math.abs(b[1] - now))[0][0];
      root.style.height = '';
      root.classList.remove('is-dragging');
      ignoreClick = true; // the press that ended a drag isn't also a click
      setTimeout(() => (ignoreClick = false), 300);
      set(nearest);
    }
    drag = null;
  };
  bar.addEventListener('pointerdown', (e) => {
    if (window.innerWidth > 800) return; // the desktop card doesn't drag
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.sheet-expand')) return;
    drag = { startY: e.clientY, startHeight: root.offsetHeight, moved: false };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  window.addEventListener('resize', applyHeights);

  apply(state);

  return {
    set,
    hide() {
      hidden = true;
      root.hidden = true;
      app.dataset.sheet = 'hidden';
      applyHeights();
    },
    get hidden() {
      return hidden;
    },
    get state() {
      return state;
    },
    // Opens a hidden or low panel; a panel that's already open keeps its size.
    open(at = 'half') {
      if (hidden || state === 'peek' || at === 'full') set(at);
    },
    setTitle(text) {
      title.textContent = text;
    },
    setContent(html) {
      body.innerHTML = html + footer;
      body.scrollTop = 0;
    },
    body,
  };
}
