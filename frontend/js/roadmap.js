import { api } from './api.js';
import { authStore, showError } from './state.js';
import { escapeHtml, getParams } from './util.js';

const slug = getParams().slug;

const status = document.querySelector('[data-status]');
const root = document.querySelector('[data-roadmap-root]');
const topicsMount = document.querySelector('[data-topics]');
const topicsStatus = document.querySelector('[data-topics-status]');
const progressError = document.querySelector('[data-progress-error]');

let roadmap = null;
/** progress state: { [topicKey]: 'done' | 'learning' | 'skipped' } */
let progress = {};

const STORAGE_PREFIX = 'roadmap-progress:';

/* ------------------------------------------------------- progress ------ */

function storageKey() {
  return STORAGE_PREFIX + slug;
}

function loadLocalProgress() {
  try {
    return JSON.parse(localStorage.getItem(storageKey()) || '{}');
  } catch {
    return {};
  }
}

function saveLocalProgress(value) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(value));
  } catch {
    /* storage full/blocked - progress simply stays in memory */
  }
}

async function loadProgress() {
  if (authStore.get().user) {
    try {
      const payload = await api.get(`/me/progress/${encodeURIComponent(slug)}`);
      progress = {};
      for (const row of payload.data.topics) progress[row.topic_key] = row.status;
    } catch {
      progress = loadLocalProgress(); // fall back to local state
    }
  } else {
    progress = loadLocalProgress();
  }
  renderProgressPanel();
  renderDoneStates();
}

function progressStats() {
  const total = roadmap?.topics_count || 0;
  const done = Object.values(progress).filter((s) => s === 'done').length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

function renderProgressPanel() {
  const { total, done, percent } = progressStats();
  document.querySelector('[data-progress-text]').textContent = `${done} / ${total} topics · ${percent}%`;
  document.querySelector('[data-progress-fill]').style.width = `${percent}%`;
  const bar = document.querySelector('[data-progress-bar]');
  bar.setAttribute('aria-valuenow', String(percent));
  document.querySelector('[data-progress-hint]').textContent = authStore.get().user
    ? 'Progress is synced to your account.'
    : 'Sign in to sync progress across devices - until then it is saved in this browser.';
}

function renderDoneStates() {
  for (const item of topicsMount.querySelectorAll('[data-topic]')) {
    const key = item.dataset.topic;
    const checkbox = item.querySelector('input[type="checkbox"]');
    const label = item.querySelector('.state-label');
    const done = progress[key] === 'done';
    if (checkbox) checkbox.checked = done;
    item.classList.toggle('is-done', done);
    if (label) label.textContent = done ? 'Completed' : 'Mark as completed';
    const pill = item.querySelector('[data-done-pill]');
    if (pill) pill.hidden = !done;
  }
  renderProgressPanel();
}

async function toggleTopic(topicKey, checkbox) {
  const wasDone = progress[topicKey] === 'done';
  const nextDone = checkbox.checked;

  // optimistic UI: state flips immediately, rolls back if the API fails
  if (nextDone) progress[topicKey] = 'done';
  else delete progress[topicKey];
  renderDoneStates();
  progressError.textContent = '';

  try {
    if (authStore.get().user) {
      if (nextDone) {
        await api.put(
          `/me/progress/${encodeURIComponent(slug)}/${encodeURIComponent(topicKey)}`,
          { status: 'done' },
        );
      } else {
        await api.del(
          `/me/progress/${encodeURIComponent(slug)}/${encodeURIComponent(topicKey)}`,
        );
      }
    } else {
      saveLocalProgress(progress);
    }
  } catch (error) {
    // rollback
    if (wasDone) progress[topicKey] = 'done';
    else delete progress[topicKey];
    renderDoneStates();
    progressError.textContent = showError(error);
  }
}

/* --------------------------------------------------------- topics ------ */

function renderTopics(topics) {
  topicsStatus.hidden = true;
  topicsMount.innerHTML = topics
    .map(
      (t) => `
      <details class="topic" data-topic="${escapeHtml(t.topic_key)}">
        <summary>
          <span class="badge neutral">${escapeHtml(String(t.order_index))}</span>
          ${escapeHtml(t.label)}
          <span class="badge beginner" data-done-pill hidden>Done ✓</span>
          <span class="chev" aria-hidden="true">›</span>
        </summary>
        <div class="topic-body">
          <label class="done-toggle">
            <input type="checkbox" data-done-checkbox />
            <span class="state-label">Mark as completed</span>
          </label>
          <div class="content" data-content aria-live="polite">
            <p class="status-line">Loading topic content…</p>
          </div>
        </div>
      </details>
    `,
    )
    .join('');

  renderDoneStates();

  for (const details of topicsMount.querySelectorAll('details.topic')) {
    const key = details.dataset.topic;
    const summary = details.querySelector('summary');
    const checkbox = details.querySelector('[data-done-checkbox]');

    checkbox.addEventListener('change', () => toggleTopic(key, checkbox));

    // keep the checkbox click from also toggling <details> (cross-browser safe)
    summary.addEventListener('click', (event) => {
      if (event.target.closest('.done-toggle, input[type="checkbox"]')) {
        event.preventDefault();
      }
    });
    // clicking the label area (but not the summary itself) still toggles the box
    details.querySelector('.done-toggle')?.addEventListener('click', (event) => {
      event.preventDefault();
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });

    details.addEventListener('toggle', () => {
      if (details.open) loadTopicContent(details, key);
    });
  }
}

async function loadTopicContent(details, topicKey) {
  const mount = details.querySelector('[data-content]');
  if (!mount || mount.dataset.loaded === 'true') return;

  try {
    const payload = await api.get(
      `/roadmaps/${encodeURIComponent(slug)}/topics/${encodeURIComponent(topicKey)}`,
    );
    const topic = payload.data;
    const articles = (topic.articles || [])
      .map(
        (a) => `
        <article class="article-resource">
          <h3 style="margin: 0.2rem 0 0.4rem; font-size: 0.98rem;">${escapeHtml(a.title)}</h3>
          ${a.contentHtml || ''}
        </article>`,
      )
      .join('');

    mount.innerHTML = `${topic.contentHtml || '<p>No content yet.</p>'}${articles}`;
    mount.dataset.loaded = 'true';
  } catch (error) {
    mount.innerHTML = `<p class="status-line error">${escapeHtml(showError(error))}
      <button class="btn btn-sm" type="button" data-retry-topic>Retry</button></p>`;
    mount.querySelector('[data-retry-topic]')?.addEventListener('click', () => {
      mount.dataset.loaded = 'false';
      loadTopicContent(details, topicKey);
    });
  }
}

/* ------------------------------------------------------- related ------- */

async function loadRelated(category) {
  try {
    const payload = await api.get('/roadmaps', { query: { category, limit: 10 } });
    const related = payload.data.filter((r) => r.slug !== slug).slice(0, 6);
    if (!related.length) return;
    const section = document.querySelector('[data-related-section]');
    section.hidden = false;
    section.querySelector('[data-related]').innerHTML = related
      .map(
        (r) =>
          `<a class="chip" href="/roadmap.html?slug=${encodeURIComponent(r.slug)}">${escapeHtml(r.title)}</a>`,
      )
      .join('');
  } catch {
    /* related links are optional */
  }
}

/* ---------------------------------------------------------- boot ------- */

async function init() {
  if (!slug) {
    status.classList.add('error');
    status.innerHTML = 'No roadmap specified. <a href="/index.html">Browse all roadmaps</a>.';
    return;
  }

  try {
    const payload = await api.get(`/roadmaps/${encodeURIComponent(slug)}`);
    roadmap = payload.data;

    document.title = `${roadmap.title} Roadmap - roadmaps.sh`;
    status.hidden = true;
    root.hidden = false;

    root.querySelector('[data-title]').textContent = roadmap.title;
    root.querySelector('[data-description]').textContent = roadmap.description || '';
    root.querySelector('[data-badges]').innerHTML = `
      <span class="badge ${escapeHtml(roadmap.category)}">${escapeHtml(roadmap.category)}</span>
      <span class="badge ${escapeHtml(roadmap.difficulty)}">${escapeHtml(roadmap.difficulty)}</span>
      <span class="badge neutral">${escapeHtml(roadmap.tag)}</span>
    `;

    if (roadmap.article_html) {
      const article = root.querySelector('[data-article]');
      article.hidden = false;
      article.innerHTML = roadmap.article_html;
    }

    if (roadmap.image_url) {
      const visual = root.querySelector('[data-visual]');
      visual.hidden = false;
      const img = visual.querySelector('[data-image]');
      img.src = roadmap.image_url;
      img.alt = `${roadmap.title} roadmap diagram`;
      img.loading = 'lazy';
      visual.querySelector('[data-image-link]').href = roadmap.image_url;
    }

    await loadProgress();
    loadRelated(roadmap.category);

    const topicsPayload = await api.get(
      `/roadmaps/${encodeURIComponent(slug)}/topics`,
    );
    if (!topicsPayload.data.length) {
      topicsStatus.textContent = 'This roadmap has no topics yet.';
    } else {
      renderTopics(topicsPayload.data);
      renderProgressPanel();
    }
  } catch (error) {
    status.classList.add('error');
    if (error.status === 404) {
      status.innerHTML = `Roadmap not found. <a href="/index.html">Browse all roadmaps</a>.`;
    } else {
      status.innerHTML = `${escapeHtml(showError(error))}
        <button class="btn btn-sm" type="button" data-retry>Retry</button>`;
      status.querySelector('[data-retry]')?.addEventListener('click', init);
    }
  }
}

// copy-link button (inline handlers are blocked by our CSP - see app.js)
document.querySelector('[data-share]')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = 'Link copied!';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => {
    button.textContent = 'Copy link';
  }, 2000);
});

// re-render progress hints when the session changes (login in another tab etc.)
authStore.subscribe(() => {
  if (roadmap) loadProgress();
});

init();
