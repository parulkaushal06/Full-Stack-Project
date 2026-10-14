/**
 * Small API client for the v1 REST API.
 * - same-origin requests (session cookie is sent automatically)
 * - throws a typed ApiError carrying { code, message, details }
 */
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details || [];
  }

  /** First validation message for a given field (server field names). */
  fieldError(field) {
    const hit = this.details.find((d) => d.field === field || d.field.startsWith(field + '.'));
    return hit ? hit.message : null;
  }
}

async function request(method, path, { body, query, headers } = {}) {
  let url = BASE + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const init = {
    method,
    credentials: 'same-origin', // send the sid session cookie
    headers: { Accept: 'application/json', ...(headers || {}) },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch {
    // network failure / server down
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  if (res.status === 204) return null;

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body (e.g. 304/html) */
  }

  if (!res.ok) {
    const err = payload && payload.error;
    throw new ApiError(
      res.status,
      (err && err.code) || `http_${res.status}`,
      (err && err.message) || `Request failed with status ${res.status}`,
      (err && err.details) || [],
    );
  }
  return payload;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
};
