/** Escapes user/API supplied text before inserting into innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Read the current query string into a plain object. */
export function getParams() {
  return Object.fromEntries(new URLSearchParams(location.search).entries());
}

/** Update a few query params (replaceState - keeps history clean). */
export function setParams(patch, { replace = true } = {}) {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const url = `${location.pathname}?${params.toString()}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Simple debounce for search inputs. */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Renders a list of server-side validation details as <li> markup. */
export function renderFieldErrors(details, field) {
  return (details || [])
    .filter((d) => d.field === field || d.field.startsWith(`${field}.`))
    .map((d) => `<li>${escapeHtml(d.message)}</li>`)
    .join('');
}
