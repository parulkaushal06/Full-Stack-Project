import { api, ApiError } from './api.js';
import { authStore, showError } from './state.js';

const form = document.querySelector('[data-form]');
if (form) {
  const isRegister = location.pathname.includes('register');
  const submitBtn = form.querySelector('[data-submit]');
  const formError = form.querySelector('[data-form-error]');
  const defaultLabel = submitBtn.textContent;

  function clearErrors() {
    formError.hidden = true;
    formError.textContent = '';
    for (const el of form.querySelectorAll('[data-error-for]')) el.textContent = '';
  }

  function setFieldError(field, message) {
    const el = form.querySelector(`[data-error-for="${field}"]`);
    if (el) el.textContent = message;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const data = Object.fromEntries(new FormData(form).entries());

    // light client-side pre-checks (the server validates again - never trust the client)
    let clientError = false;
    if (!String(data.identifier || data.username || '').trim()) {
      setFieldError(isRegister ? 'username' : 'identifier', 'This field is required.');
      clientError = true;
    }
    if (!data.password) {
      setFieldError('password', 'Password is required.');
      clientError = true;
    }
    if (isRegister && !data.email) {
      setFieldError('email', 'Email is required.');
      clientError = true;
    }
    if (clientError) return;

    submitBtn.disabled = true;
    submitBtn.textContent = isRegister ? 'Creating account…' : 'Signing in…';

    try {
      const payload = isRegister
        ? await api.post('/auth/register', {
            username: String(data.username).trim(),
            email: String(data.email).trim(),
            password: data.password,
          })
        : await api.post('/auth/login', {
            identifier: String(data.identifier).trim(),
            password: data.password,
          });

      authStore.set({ user: payload.data.user, loaded: true });

      // validated redirect: only same-site paths
      const next = new URLSearchParams(location.search).get('next');
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/index.html';
      location.href = target;
    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = defaultLabel;

      if (error instanceof ApiError && error.details.length) {
        let firstField = null;
        for (const detail of error.details) {
          const field = detail.field.split('.')[0];
          setFieldError(field, detail.message);
          firstField = firstField || field;
        }
        form.querySelector(`[name="${firstField}"]`)?.focus();
      } else {
        formError.hidden = false;
        formError.textContent = showError(error);
        if (error.status === 401) {
          form.querySelector('[name="password"]')?.focus();
        }
      }
    }
  });

  // already signed in? no reason to sit on the login page
  authStore.subscribe((state) => {
    if (state.loaded && state.user) {
      const next = new URLSearchParams(location.search).get('next');
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/index.html';
      if (!location.pathname.includes(target.replace('/index.html', '')) || target !== location.pathname) {
        location.replace(target);
      }
    }
  });
}
