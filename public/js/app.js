const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const authScreen = $('#auth-screen');
const mainScreen = $('#main-screen');
const loginForm = $('#login-form');
const registerForm = $('#register-form');
const authError = $('#auth-error');
const postForm = $('#post-form');
const postError = $('#post-error');
const feedEl = $('#feed');
const feedEmpty = $('#feed-empty');

let currentUser = null;

// ================= API =================
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ================= UI HELPERS =================
function showError(el, msg) {
  el.textContent = msg;
  el.hidden = !msg;
}
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function timeAgo(ts) {
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ================= VIEW =================
function setView(view) {
  $('#view-feed').hidden = view !== 'feed';
  $('#view-create').hidden = view !== 'create';
  $$('.nav-item, .mobile-nav-btn').forEach(el => {
    if (el.dataset.view) el.classList.toggle('active', el.dataset.view === view);
  });
}

// ================= PROFILE =================
function updateProfileUI() {
  const name = currentUser?.name || 'Guest';
  $('#user-greeting').textContent = `Hi, ${name}`;
  $('#sidebar-name').textContent = name;
  $('#sidebar-avatar').textContent = initials(name);
}

// ================= RENDER POST =================
function renderPost(post) {
  const liked = currentUser && post.likes.includes(currentUser.username);
  const isOwner = currentUser && post.author &&
    currentUser.username.toLowerCase() === post.author.toLowerCase();

  console.log('currentUser:', currentUser?.username, 'post.author:', post.author, 'isOwner:', isOwner);

  const card = document.createElement('article');
  card.className = 'post-card';
  card.dataset.id = post.id;

  const imgHtml = post.imageUrl
    ? `<img class="post-image" src="${escapeAttr(post.imageUrl)}" loading="lazy">`
    : '';

  card.innerHTML = `
    <div class="post-header">
      <div class="avatar">${escapeHtml(initials(post.authorName))}</div>
      <div>
        <div class="post-author">${escapeHtml(post.authorName)}</div>
        <div class="post-time">${timeAgo(post.createdAt)}</div>
      </div>
    </div>
    ${imgHtml}
    <div class="post-body">
      ${post.text ? `<p class="post-text">${escapeHtml(post.text)}</p>` : ''}
    </div>
    <div class="post-actions">
      <button class="btn-like ${liked ? 'liked' : ''}" data-like>
        ${liked ? '♥' : '♡'} ${post.likes.length} likes
      </button>
      ${isOwner ? `<button class="delete-btn" data-delete>Delete</button>` : ''}
    </div>
  `;

  card.querySelector('[data-like]').addEventListener('click', () => toggleLike(post.id));
  const deleteBtn = card.querySelector('[data-delete]');
  if (deleteBtn) deleteBtn.addEventListener('click', () => deletePost(post.id));

  return card;
}

// ================= FEED =================
async function loadFeed() {
  const { posts } = await api('/api/posts');
  feedEl.innerHTML = '';
  feedEmpty.hidden = posts.length > 0;
  posts.forEach(post => feedEl.appendChild(renderPost(post)));
}

// ================= LIKE =================
async function toggleLike(id) {
  try {
    await api(`/api/posts/${id}/like`, { method: 'POST' });
    await loadFeed();
  } catch (err) { alert(err.message); }
}

// ================= DELETE =================
async function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  try {
    await api(`/api/posts/${id}`, { method: 'DELETE' });
    await loadFeed();
  } catch (err) { alert(err.message); }
}

// ================= AUTH =================
function showAuth() { authScreen.hidden = false; mainScreen.hidden = true; currentUser = null; }
function showMain() {
  authScreen.hidden = true;
  mainScreen.hidden = false;
  updateProfileUI();
  setView('feed');
  loadFeed(); // ensure feed reloads after login
}

// ================= SESSION =================
async function checkSession() {
  try {
    const { user } = await api('/api/me');
    if (user) { currentUser = user; showMain(); }
    else showAuth();
  } catch { showAuth(); }
}

// ================= LOGIN =================
loginForm.addEventListener('submit', async e => {
  e.preventDefault(); showError(authError, '');
  const fd = new FormData(loginForm);
  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
    });
    currentUser = user; showMain();
  } catch (err) { showError(authError, err.message); }
});

// ================= REGISTER =================
registerForm.addEventListener('submit', async e => {
  e.preventDefault(); showError(authError, '');
  const fd = new FormData(registerForm);
  try {
    const { user } = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        username: fd.get('username'),
        password: fd.get('password'),
      }),
    });
    currentUser = user; showMain();
  } catch (err) { showError(authError, err.message); }
});

// ================= LOGOUT =================
async function logout() { await api('/api/logout', { method: 'POST' }); showAuth(); }
$('#logout-btn').addEventListener('click', logout);
$('#mobile-logout').addEventListener('click', logout);

// ================= CREATE POST =================
postForm.addEventListener('submit', async e => {
  e.preventDefault(); showError(postError, '');
  const fd = new FormData(postForm);
  try {
    await api('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text: fd.get('text'), imageUrl: fd.get('imageUrl') }),
    });
    postForm.reset(); setView('feed'); await loadFeed();
  } catch (err) { showError(postError, err.message); }
});

// ================= NAV =================
function bindNav() {
  const go = view => e => { e.preventDefault(); setView(view); if (view === 'feed') loadFeed(); };
  $$('.nav-item, .mobile-nav-btn').forEach(el => {
    if (el.dataset.view) el.addEventListener('click', go(el.dataset.view));
  });
}
bindNav();
checkSession();
