import { api } from './api.js';
import { showError } from './state.js';
import { escapeHtml, getParams, setParams, debounce } from './util.js';

const PAGE_LIMIT = 12;

const grid = document.querySelector('[data-grid]');
const status = document.querySelector('[data-status]');
const pager = document.querySelector('[data-pager]');
const pageInfo = document.querySelector('[data-page-info]');
const prevBtn = document.querySelector('[data-prev]');
const nextBtn = document.querySelector('[data-next]');
const searchInput = document.querySelector('#search');
const difficultySelect = document.querySelector('#difficulty');
const sortSelect = document.querySelector('#sort');
const chips = document.querySelectorAll('[data-chips] .chip');

/** Local (URL) state - the single source of truth for this view. */
function currentState() {
  const params = getParams();
  return {
    search: params.q || '',
    category: params.category || '',
    difficulty: params.difficulty || '',
    sort: params.sort || 'order',
    page: Math.max(1, parseInt(params.page, 10) || 1),
  };
}

function syncControls(state) {
  searchInput.value = state.search;
  difficultySelect.value = state.difficulty;
  sortSelect.value = state.sort;
  for (const chip of chips) {
    chip.setAttribute('aria-pressed', String(chip.dataset.category === state.category));
  }
}

function showSkeletons(count = 6) {
  grid.innerHTML = Array.from({ length: count }, () => '<div class="skeleton" aria-hidden="true"></div>').join('');
}

function renderCards(items) {
  grid.innerHTML = items
    .map((r) => {
      const description = r.description || 'No description yet.';
      return `
        <a class="card" href="/roadmap.html?slug=${encodeURIComponent(r.slug)}">
          <div class="card-meta">
            <span class="badge ${escapeHtml(r.category)}">${escapeHtml(r.category)}</span>
            <span class="badge ${escapeHtml(r.difficulty)}">${escapeHtml(r.difficulty)}</span>
          </div>
          <h2>${escapeHtml(r.title)}</h2>
          <p>${escapeHtml(description)}</p>
          <span class="badge neutral">${escapeHtml(r.tag)}</span>
        </a>
      `;
    })
    .join('');
}

function renderPager(meta, links) {
  if (!meta || meta.total === 0) {
    pager.hidden = true;
    return;
  }
  pager.hidden = false;
  pageInfo.textContent = `Page ${meta.page} of ${meta.totalPages} · ${meta.total} roadmaps`;
  prevBtn.disabled = !links.prev;
  nextBtn.disabled = !links.next;
}

async function load() {
  const state = currentState();
  syncControls(state);

  grid.hidden = false;
  showSkeletons();
  status.classList.remove('error');
  status.textContent = 'Loading roadmaps…';

  try {
    const payload = await api.get('/roadmaps', {
      query: {
        page: state.page,
        limit: PAGE_LIMIT,
        search: state.search,
        category: state.category,
        difficulty: state.difficulty,
        sort: state.sort,
        order: 'asc',
      },
    });

    if (!payload.data.length) {
      grid.hidden = true;
      status.textContent = 'No roadmaps match your filters.';
      renderPager(null);
      return;
    }

    renderCards(payload.data);
    renderPager(payload.meta, payload.links);
    status.textContent = `Showing ${payload.data.length} of ${payload.meta.total} roadmaps.`;
  } catch (error) {
    grid.hidden = true;
    status.classList.add('error');
    status.innerHTML = `${escapeHtml(showError(error))} <button class="btn btn-sm" type="button" data-retry>Retry</button>`;
    status.querySelector('[data-retry]')?.addEventListener('click', load);
  }
}

/* ------------------------------------------------------------ events --- */

const update = (patch) => {
  setParams({ ...patch, page: patch.page || undefined });
  load();
};

searchInput.addEventListener(
  'input',
  debounce(() => update({ q: searchInput.value.trim() }), 300),
);

difficultySelect.addEventListener('change', () => update({ difficulty: difficultySelect.value }));
sortSelect.addEventListener('change', () => update({ sort: sortSelect.value }));

for (const chip of chips) {
  chip.addEventListener('click', () => update({ category: chip.dataset.category }));
}

prevBtn.addEventListener('click', () => {
  update({ page: String(Math.max(1, currentState().page - 1)) });
  grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
nextBtn.addEventListener('click', () => {
  update({ page: String(currentState().page + 1) });
  grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

window.addEventListener('popstate', load);

load();
