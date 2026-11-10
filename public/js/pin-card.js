// Barrier details in a small card attached to the pin, like tapping an alert in Waze or a place
// in Google Maps on a computer. The map stays usable: choose another pin to move the card, or
// close it with the X, Escape or a click on the map. Phones show details in the bottom sheet
// instead, since a card beside a pin would cover most of a small screen.
// Used by the home map and Explore.
import { icon } from './ui.js';
import { latLng } from './mapbase.js';
import { barrierCardHtml, saveResponse } from './barrier-card.js';

const PIN_HEIGHT = 46; // the card's tip sits just above the pin's head

export function createPinCard(map, { getAvoid, onOpen, onClose, onUpdated, onReportHere, onPlanHere, planLink = true } = {}) {
  let view = null; // { reports, index, answered, error, opener }
  const popup = L.popup({
    className: 'pin-popup',
    closeButton: false, // the card draws its own, labelled close button
    minWidth: 340,
    maxWidth: 340,
    offset: [0, -PIN_HEIGHT],
    autoPan: true,
  });

  const current = () => view && view.reports[view.index];
  const html = () =>
    `<button type="button" class="pin-popup-close" data-action="close" aria-label="Close barrier details">${icon('close', 20)}</button>
    ${barrierCardHtml(view, { planLink })}`;
  const focusTitle = () => popup.getElement()?.querySelector('#barrier-view-title')?.focus({ preventScroll: true });

  function render() {
    popup.setContent(html()); // redraws and keeps the card in view
    focusTitle();
  }

  // Opens the card on a pin. `reports` are the reports at that stop; `index` picks one.
  function open(reports, index = 0, { opener = null } = {}) {
    view = { reports, index, answered: null, error: null, opener };
    // Keep the card clear of the floating panels when the map pans to show it.
    const avoid = getAvoid?.() ?? {};
    popup.options.autoPanPaddingTopLeft = L.point(avoid.topLeft ?? [20, 20]);
    popup.options.autoPanPaddingBottomRight = L.point(avoid.bottomRight ?? [20, 20]);
    popup.setLatLng(latLng(current().location)).setContent(html());
    if (!popup.isOpen()) popup.openOn(map);
    onOpen?.(current());
    focusTitle();
  }

  function close({ restoreFocus = false } = {}) {
    const opener = view?.opener;
    if (popup.isOpen()) map.closePopup(popup);
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }

  // However it closes (X, Escape, a click on the map, another view), tidy up.
  popup.on('remove', () => {
    view = null;
    onClose?.();
  });

  // The card's buttons. Wired once, the first time the card is drawn.
  popup.on('add', () => {
    const el = popup.getElement();
    if (el.dataset.wired) return;
    el.dataset.wired = 'true';
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close({ restoreFocus: true });
    });
    el.addEventListener('click', async (e) => {
      const button = e.target.closest('button');
      if (!button || !view) return;
      const report = current();
      if (button.dataset.action === 'close') {
        close({ restoreFocus: true });
      } else if (button.dataset.step) {
        view.index += Number(button.dataset.step);
        view.error = null;
        render();
        onOpen?.(current());
      } else if (button.dataset.response) {
        button.closest('.pin-responses')?.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          const updated = await saveResponse(report, button.dataset.response);
          view.reports[view.index] = updated;
          view.answered = updated.id;
          view.error = null;
          onUpdated?.(updated);
        } catch (err) {
          view.error = err.message;
        }
        render();
      } else if (button.dataset.action === 'report-here') {
        onReportHere?.(report.location);
      } else if (button.dataset.action === 'plan-here') {
        close();
        onPlanHere?.(report.location);
      }
    });
  });

  return {
    open,
    close,
    get isOpen() {
      return popup.isOpen();
    },
    get report() {
      return current();
    },
  };
}
