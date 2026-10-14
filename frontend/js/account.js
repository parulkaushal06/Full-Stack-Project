import { api } from './api.js';
import { authStore, showError } from './state.js';
import { escapeHtml, formatDate } from './util.js';

const statusEl = document.querySelector('[data-status]');
const accountEl = document.querySelector('[data-account]');
const progressStatus = document.querySelector('[data-progress-status]');
const progressList = document.querySelector('[data-progress-list]');

function renderProfile(user) {
  accountEl.hidden = false;
  statusEl.hidden = true;
  document.querySelector('[data-avatar]').textContent = (user.username || '?').charAt(0).toUpperCase();
  document.querySelector('[data-username]').textContent = user.username;
  document.querySelector('[data-email]').textContent = user.email;
  document.querySelector('[data-role]').textContent = user.role;
  document.querySelector('[data-admin-note]').hidden = user.role !== 'admin';
}

function renderProgressItem(summary) {
  const item = document.createElement('article');
  item.className = 'progress-item';
  item.innerHTML = `
    <div class="head">
      <h3><a href="/roadmap.html?slug=${encodeURIComponent(summary.roadmapSlug)}">${escapeHtml(summary.roadmapTitle)}</a></h3>
      <strong>${summary.percent}%</strong>
    </div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
         aria-valuenow="${summary.percent}" aria-label="${escapeHtml(summary.roadmapTitle)} progress">
      <div class="progress-fill" style="width: ${summary.percent}%"></div>
    </div>
    <p class="topics-done">${summary.done} of ${summary.totalTopics} topics completed
      ${summary.learning ? ` · ${summary.learning} in progress` : ''}
      ${summary.updatedAt ? ` · updated ${escapeHtml(formatDate(summary.updatedAt))}` : ''}</p>
  `;
  return item;
}

async function loadProgress() {
  try {
    const listPayload = await api.get('/me/progress');
    const slugs = [...new Set(listPayload.data.map((row) => row.roadmapSlug))];

    if (!slugs.length) {
      progressStatus.textContent = 'No progress yet - open a roadmap and start checking off topics.';
      return;
    }

    const summaries = await Promise.all(
      slugs.map((slug) => api.get(`/me/progress/${encodeURIComponent(slug)}`)),
    );

    progressStatus.hidden = true;
    progressList.innerHTML = '';
    for (const payload of summaries) {
      const summary = payload.data;
      // most recent activity first
      const updated =
        summary.topics.map((t) => t.updated_at || t.updatedAt || '').sort().pop() || '';
      summary.updatedAt = updated;
      progressList.appendChild(renderProgressItem(summary));
    }
  } catch (error) {
    progressStatus.classList.add('error');
    progressStatus.textContent = showError(error);
  }
}

async function boot() {
  // wait for nav.js to resolve the session
  await new Promise((resolve) => {
    if (authStore.get().loaded) return resolve();
    const unsubscribe = authStore.subscribe((state) => {
      if (state.loaded) {
        unsubscribe();
        resolve();
      }
    });
  });

  const user = authStore.get().user;
  if (!user) {
    location.href = '/login.html?next=/account.html';
    return;
  }

  renderProfile(user);
  await loadProgress();

  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      location.href = '/index.html';
    }
  });
}

boot();
