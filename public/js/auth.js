const $ = (sel) => document.querySelector(sel);

const loginForm = $('#login-form');
const registerForm = $('#register-form');
const authError = $('#auth-error');

const HOME_PAGE = '/home.html';

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showError(msg) {
  authError.textContent = msg;
  authError.hidden = !msg;
}

function goHome() {
  window.location.href = HOME_PAGE;
}

async function checkSession() {
  try {
    const { user } = await api('/api/me');
    if (user) goHome();
  } catch {
    /* stay on login page */
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const fd = new FormData(loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
      }),
    });
    goHome();
  } catch (err) {
    showError(err.message);
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const fd = new FormData(registerForm);
  try {
    await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        username: fd.get('username'),
        password: fd.get('password'),
      }),
    });
    goHome();
  } catch (err) {
    showError(err.message);
  }
});

checkSession();
