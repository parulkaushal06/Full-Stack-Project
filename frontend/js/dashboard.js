import { api } from './api.js';
import { authStore, showError } from './state.js';
import { escapeHtml } from './util.js';

/**
 * Learning dashboard (Person 2).
 * One request powers the whole page: GET /me/progress/summary.
 * Status mapping (PRD): 'done' = Completed, 'learning' = In Progress,
 * no row = Not Started.
 */
const statusEl = document.querySelector('[data-status]');
const dashEl = document.querySelector('[data-dashboard]');
const roadmapsStatus = document.querySelector('[data-roadmaps-status]');

/** Keep long topic lists scannable on big roadmaps. */
const LIST_LIMIT = 10;

function renderStats(data) {
  document.querySelector('[data-stat-completed]').textContent = data.totals.completed;
  document.querySelector('[data-stat-inprogress]').textContent = data.totals.inProgress;
  document.querySelector('[data-stat-notstarted]').textContent = data.totals.notStarted;
  document.querySelector('[data-stat-percent]').textContent = `${data.overallPercent}%`;
}

function renderContinue(cont) {
  if (!cont) return;
  document.querySelector('[data-continue]').hidden = false;
  document.querySelector('[data-continue-text]').textContent =
    `${cont.topicLabel} · ${cont.roadmapTitle}`;
  document.querySelector('[data-continue-link]').href =
    `/roadmap.html?slug=${encodeURIComponent(cont.slug)}`;
}

function renderRoadmaps(roadmaps) {
  const list = document.querySelector('[data-roadmap-list]');
  if (!roadmaps.length) {
    roadmapsStatus.textContent = 'No progress yet - open a roadmap and start tracking topics.';
    return;
  }
  roadmapsStatus.hidden = true;
  list.innerHTML = roadmaps
    .map(
      (r) => `
    <article class="progress-item">
      <div class="head">
        <h3><a href="/roadmap.html?slug=${encodeURIComponent(r.slug)}">${escapeHtml(r.title)}</a></h3>
        <strong>${r.percent}%</strong>
      </div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${r.percent}" aria-label="${escapeHtml(r.title)} progress">
        <div class="progress-fill" style="width: ${r.percent}%"></div>
      </div>
      <p class="topics-done">${r.completed} completed · ${r.inProgress} in progress ·
         ${r.notStarted} not started of ${r.totalTopics} topics</p>
    </article>`,
    )
    .join('');
}

function fillTopicList(selector, items, emptyMessage) {
  const el = document.querySelector(selector);
  if (!items.length) {
    el.innerHTML = `<li class="empty-line">${escapeHtml(emptyMessage)}</li>`;
    return;
  }
  const shown = items.slice(0, LIST_LIMIT);
  const rows = shown
    .map(
      ({ roadmap, topic }) => `
      <li>
        <a href="/roadmap.html?slug=${encodeURIComponent(roadmap.slug)}">
          ${escapeHtml(roadmap.title)} › ${escapeHtml(topic.label)}
        </a>
        <span class="badge ${topic.status === 'learning' ? 'intermediate' : 'neutral'}">
          ${topic.status === 'learning' ? 'In progress' : 'Not started'}
        </span>
      </li>`,
    )
    .join('');
  const more =
    items.length > shown.length
      ? `<li class="empty-line">…and ${items.length - shown.length} more</li>`
      : '';
  el.innerHTML = rows + more;
}

function renderTopicLists(roadmaps) {
  const ongoing = [];
  const pending = [];
  for (const roadmap of roadmaps) {
    for (const topic of roadmap.topics) {
      if (topic.status === 'learning') ongoing.push({ roadmap, topic });
      else if (topic.status !== 'done') pending.push({ roadmap, topic });
    }
  }
  fillTopicList(
    '[data-ongoing-list]',
    ongoing,
    'Nothing in progress yet - open a topic and set it to In Progress.',
  );
  fillTopicList(
    '[data-pending-list]',
    pending,
    'All topics in your started roadmaps are completed. Nice work!',
  );
}

async function boot() {
  // wait for nav.js to resolve the session (same pattern as account.js)
  await new Promise((resolve) => {
    if (authStore.get().loaded) return resolve();
    const unsubscribe = authStore.subscribe((state) => {
      if (state.loaded) {
        unsubscribe();
        resolve();
      }
    });
  });

  if (!authStore.get().user) {
    location.href = '/login.html?next=/dashboard.html';
    return;
  }

  try {
    const payload = await api.get('/me/progress/summary');
    const data = payload.data;
    statusEl.hidden = true;
    dashEl.hidden = false;
    renderStats(data);
    renderContinue(data.continueLearning);
    renderRoadmaps(data.roadmaps);
    renderTopicLists(data.roadmaps);
  } catch (error) {
    statusEl.classList.add('error');
    statusEl.textContent = showError(error);
  }
}

boot();
