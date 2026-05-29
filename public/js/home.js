// ================= SELECTORS =================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const postForm = $('#post-form');
const postError = $('#post-error');
const feedEl = $('#feed');
const feedEmpty = $('#feed-empty');
const postFormTitle = $('#post-form-title');
const cancelEditBtn = $('#cancel-edit');

const LOGIN_PAGE = '/';
let currentUser = null;
let editingPostId = null;
let editingPostImageUrl = '';

// ================= API =================
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

// Upload image separately
async function uploadImage(file) {
  const fd = new FormData();
  fd.append('image', file);

  const res = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Image upload failed');
  return data.imageUrl;
}

// ================= HELPERS =================
function showError(el, msg) {
  el.textContent = msg;
  el.hidden = !msg;
}

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function timeAgo(ts) {
  const date = new Date(ts);
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function formatExactTime(ts) {
  return new Date(ts).toLocaleString();
}

function setView(view) {
  $('#view-feed').hidden = view !== 'feed';
  $('#view-create').hidden = view !== 'create';
  $$('.nav-item, .mobile-nav-btn').forEach((el) => {
    if (el.dataset.view) {
      el.classList.toggle('active', el.dataset.view === view);
    }
  });
}

function updateProfileUI() {
  const name = currentUser?.name || 'Guest';
  $('#user-greeting').textContent = `Hi, ${currentUser?.name || ''}`;
  $('#sidebar-name').textContent = name;
  $('#sidebar-avatar').textContent = initials(name);
}

function resetPostForm() {
  postForm.reset();
  postFormTitle.textContent = 'New post';
  postForm.querySelector('[name="imageUrl"]').value = '';
  cancelEditBtn.hidden = true;
  editingPostId = null;
  editingPostImageUrl = '';
}

function startEditingPost(post) {
  setView('create');
  postFormTitle.textContent = 'Edit post';
  postForm.querySelector('[name="text"]').value = post.text || '';
  postForm.querySelector('[name="imageUrl"]').value = post.imageUrl || '';
  postForm.querySelector('[name="imageFile"]').value = '';
  cancelEditBtn.hidden = false;
  editingPostId = post.id;
  editingPostImageUrl = post.imageUrl || '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ================= RENDER POST =================
function renderPost(post) {
  const liked = currentUser && post.likes.includes(currentUser.username);
  const isOwner = currentUser && post.author &&
    currentUser.username.toLowerCase() === post.author.toLowerCase();

  const card = document.createElement('article');
  card.className = 'post-card';
  card.dataset.id = post.id;

  const imgHtml = post.imageUrl
    ? `<img class="post-image" src="${escapeAttr(post.imageUrl)}" alt="Post image" loading="lazy">`
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
      <button type="button" class="btn-like ${liked ? 'liked' : ''}" data-like>
        ${liked ? '♥' : '♡'} ${post.likes.length} likes
      </button>
      ${isOwner ? `<button type="button" class="edit-btn" data-edit>Edit</button>` : ''}
      ${isOwner ? `<button type="button" class="delete-btn" data-delete>Delete</button>` : ''}
    </div>
  `;

  card.querySelector('[data-like]').addEventListener('click', () => toggleLike(post.id));
  const editBtn = card.querySelector('[data-edit]');
  if (editBtn) editBtn.addEventListener('click', () => startEditingPost(post));
  const deleteBtn = card.querySelector('[data-delete]');
  if (deleteBtn) deleteBtn.addEventListener('click', () => deletePost(post.id));

  return card;
}

// ================= FEED =================
async function loadFeed() {
  const { posts } = await api('/api/posts');
  feedEl.innerHTML = '';
  feedEmpty.hidden = posts.length > 0;
  posts.forEach((post) => feedEl.appendChild(renderPost(post)));
}

// ================= LIKE =================
async function toggleLike(id) {
  try {
    await api(`/api/posts/${id}/like`, { method: 'POST' });
    await loadFeed();
  } catch (err) {
    alert(err.message);
  }
}

// ================= DELETE =================
async function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  try {
    await api(`/api/posts/${id}`, { method: 'DELETE' });
    await loadFeed();
  } catch (err) {
    alert(err.message);
  }
}

// ================= AUTH =================
async function requireLogin() {
  try {
    const { user } = await api('/api/me');
    if (!user) {
      window.location.href = LOGIN_PAGE;
      return false;
    }
    currentUser = user;
    updateProfileUI();
    return true;
  } catch {
    window.location.href = LOGIN_PAGE;
    return false;
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  window.location.href = LOGIN_PAGE;
}

$('#logout-btn').addEventListener('click', logout);
$('#mobile-logout').addEventListener('click', logout);

// ================= CREATE POST =================
postForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(postError, '');
  const fd = new FormData(postForm);
  try {
    const imageFile = fd.get('imageFile');
    let imageUrl = fd.get('imageUrl')?.trim() || '';
    if (imageFile && imageFile.size > 0) {
      imageUrl = await uploadImage(imageFile);
    }

    const payload = {
      text: fd.get('text')?.trim() || '',
      imageUrl,
    };
    const method = editingPostId ? 'PUT' : 'POST';
    const url = editingPostId ? `/api/posts/${editingPostId}` : '/api/posts';

    await api(url, {
      method,
      body: JSON.stringify(payload),
    });

    resetPostForm();
    setView('feed');
    await loadFeed();
  } catch (err) {
    showError(postError, err.message);
  }
});

cancelEditBtn.addEventListener('click', () => {
  showError(postError, '');
  resetPostForm();
});
// ================= NAV =================
function bindNav() {
  const go = (view) => (e) => {
    e.preventDefault();
    setView(view);
    if (view === 'feed') loadFeed();
  };
  $$('.nav-item, .mobile-nav-btn').forEach((el) => {
    if (el.dataset.view) {
      el.addEventListener('click', go(el.dataset.view));
    }
  });
}

// ================= INIT =================
async function init() {
  const ok = await requireLogin();
  if (!ok) return;
  bindNav();
  setView('feed');
  loadFeed();
}

init();
