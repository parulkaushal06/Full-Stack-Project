import { api } from './api.js';

/**
 * Minimal observable store - the plain-JS version of the
 * "global state + subscribers" pattern (Context/Redux/Pinia in frameworks):
 *
 *   const store = createStore({ count: 0 });
 *   store.subscribe((state) => render(state));  // components re-render
 *   store.set({ count: 1 });                    // action -> state change
 */
export function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    get() {
      return state;
    },
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const listener of listeners) listener(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Global auth/session state shared by nav, forms and pages. */
export const authStore = createStore({ user: null, loaded: false });

/**
 * Data fetching lifecycle helper: loading -> success | error.
 * Mirrors the loading/error/optimistic states used with React Query/SWR.
 */
export async function fetchState(run, { initial = null } = {}) {
  return { status: 'loading', data: initial, error: null, run };
}

export function showError(error, fallback = 'Something went wrong.') {
  if (!error) return '';
  if (error.code === 'network_error') return 'Network error - is the server running?';
  return error.message || fallback;
}

/** Resolves the current session once on page load. */
export async function loadAuth() {
  try {
    const payload = await api.get('/auth/me');
    authStore.set({ user: payload.data.user, loaded: true });
    return payload.data.user;
  } catch {
    authStore.set({ user: null, loaded: true });
    return null;
  }
}
