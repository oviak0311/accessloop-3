// Search-as-you-type box with a suggestion list, following the ARIA combobox pattern:
// arrow keys move through suggestions, Enter picks one, Escape closes the list.
import { esc } from './ui.js';

export function createCombobox({ input, list, idPrefix, search, renderItem, onChoose, minChars = 2, delay = 250, emptyText }) {
  let items = [];
  let active = -1;
  let timer;
  let request = 0;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const showMessage = (text) => {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.innerHTML = `<li class="search-empty" role="option" aria-disabled="true">${esc(text)}</li>`;
    input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.innerHTML = items
      .map((item, i) => `<li id="${idPrefix}-${i}" role="option" data-index="${i}" aria-selected="${i === active}">${renderItem(item)}</li>`)
      .join('');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${idPrefix}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const choose = (item) => {
    close();
    onChoose(item);
  };
  // Suggestions on screen still belong to the earlier text until the new search answers.
  let stale = false;

  const run = async () => {
    const q = input.value.trim();
    if (q.length < minChars) return close();
    const id = ++request;
    try {
      const found = await search(q);
      if (id !== request) return; // a newer search started
      stale = false;
      items = found;
      active = -1;
      if (items.length) render();
      else showMessage(emptyText ?? 'No matches');
    } catch (err) {
      if (id === request) showMessage(err.message);
    }
  };

  input.addEventListener('input', () => {
    stale = true;
    request++; // answers for the earlier text are no longer wanted
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  });
  input.addEventListener('keydown', (e) => {
    const open = !list.hidden && items.length;
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      active = (active + 1) % items.length;
      render();
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      active = (active - 1 + items.length) % items.length;
      render();
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      choose(items[active]); // the suggestion picked with the arrow keys
    } else if (e.key === 'Enter' && stale && input.value.trim().length >= minChars) {
      // Typed and pressed Enter before the suggestions caught up: search now, take the top match.
      e.preventDefault();
      clearTimeout(timer);
      run().then(() => {
        if (!stale && items.length) choose(items[0]);
      });
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(items[0]);
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault(); // inside a pop-up, Escape closes the list first, not the pop-up
      e.stopPropagation();
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the box
  list.addEventListener('click', (e) => {
    const option = e.target.closest('[data-index]');
    if (option) choose(items[Number(option.dataset.index)]);
  });

  return { close };
}
