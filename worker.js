/* Cloudflare Worker */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://ark.dockl.com',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
};
const ALLOWED_CORS_ORIGINS = new Set(['https://ark.dockl.com', 'https://www.ark.dockl.com']);

const GB = 1073741824;
const UNLIMITED_STORAGE_CAP = -1;
const UNLIMITED_STORAGE_ALIASES = ['unlimited', '∞', 'inf', 'infinite'];
const BASE_STORAGE = 50 * GB;
const FILE_LIMIT = 2000 * 1024 * 1024; // 2GB (Telegram MTProto limit via bridge)
const JWT_EXPIRY_SECONDS = 86400 * 30;
const PBKDF2_ITERATIONS = 100000;
const CRYPTO_DECIMALS = 8;
const PAYMENT_TOLERANCE = 1 / 10 ** CRYPTO_DECIMALS;
const EXTERNAL_API_TIMEOUT_MS = 15000;
const EXTERNAL_API_RETRIES = 1;
const RATE_CACHE_TTL_MS = 60000;
const RATE_CACHE = new Map();
const EXTERNAL_ERROR_BODY_MAX_LENGTH = 240;
const TEST_MODE_BYPASS_HASH = 'ARK_TEST_BYPASS'; // REMOVE BEFORE GOING LIVE
const PAYMENT_WALLETS = {
  BTC: 'bc1qy0rc5kq9wacgzau7f92wu8ch5ye0aet7c6urhc',
  LTC: 'ltc1q9casldmsejj9pxsqd5c0222htkq6xqvhvmqnhr',
  XMR: '4254cXFs8vLXCEVm1T7TDAdovjqMiNZX8aym8DiMM2EiUVbDnhRQt6uauFyTeP2pkqXtcodDWPoPg1nrQNsz8xuqP3q3rrQ',
};
const DEFAULT_TIER_CONFIG = {
  starter: { priceEur: 0.00, storageLimit: 50 * GB },
  pro: { priceEur: 2.50, storageLimit: 500 * GB },
  creator: { priceEur: 9.00, storageLimit: 2 * 1024 * GB },
  studio: { priceEur: 35.00, storageLimit: 15 * 1024 * GB },
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(request) });
    const { pathname } = new URL(request.url);
    const withCors = (response) => applyCorsHeaders(request, response);
    try {
      if (pathname === '/admin' && request.method === 'GET') return withCors(await serveAdminPage());
      if (pathname === '/admin/users' && request.method === 'GET') return withCors(await listAdminUsers(request, env));
      if (pathname === '/admin/users/storage-limit' && request.method === 'POST') return withCors(await updateUserStorageLimit(request, env));
      if (pathname === '/admin/users/delete' && request.method === 'POST') return withCors(await adminDeleteUser(request, env));
      if (pathname === '/admin/users/purge-files' && request.method === 'POST') return withCors(await adminPurgeUserFiles(request, env));

      if (pathname === '/auth/register' && request.method === 'POST') return withCors(await register(request, env));
      if (pathname === '/auth/login' && request.method === 'POST') return withCors(await login(request, env));
      if (pathname === '/auth/me' && request.method === 'GET') return withCors(await getMe(request, env));
      if (pathname === '/verify-payment' && request.method === 'POST') return withCors(await verifyPayment(request, env));

      if (pathname === '/files/upload' && request.method === 'POST') return withCors(await uploadFile(request, env));
      if (pathname === '/files' && request.method === 'GET') return withCors(await listFiles(request, env));
      if (pathname === '/files/download' && request.method === 'GET') return withCors(await downloadFile(request, env));
      if (pathname === '/files/view' && request.method === 'GET') return withCors(await viewFile(request, env));
      if (pathname === '/files/delete' && request.method === 'POST') return withCors(await deleteFile(request, env));

      return withCors(jsonError('Not found', 404, 'not_found'));
    } catch (err) {
      return withCors(jsonError(`Server error: ${err.message}`, 500, 'server_error'));
    }
  }
};

function corsHeadersFor(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = origin && ALLOWED_CORS_ORIGINS.has(origin) ? origin : CORS_HEADERS['Access-Control-Allow-Origin'];
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
  };
}

function applyCorsHeaders(request, response) {
  const headers = new Headers(response.headers);
  const cors = corsHeadersFor(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function serveAdminPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ARK | Admin Console</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0a0a;
      --surface: #111111;
      --surface-accent: #1a1a1a;
      --border: rgba(255,255,255,.07);
      --border-strong: rgba(255,255,255,.12);
      --text: #f0f0f0;
      --muted: #666;
      --muted-light: #888;
      --accent: #ff6b00;
      --accent-soft: rgba(255,107,0,.12);
      --error: #ff4444;
      --success: #00cc66;
      --font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-body);
      min-height: 100vh;
      position: relative;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: radial-gradient(rgba(255,255,255,.025) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }
    .wrap {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 18px 24px;
      position: relative;
      z-index: 1;
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
    }
    .brand {
      font-weight: 900;
      font-size: 1.4rem;
      letter-spacing: 5px;
      text-transform: uppercase;
    }
    .brand span { color: var(--accent); }
    .brand-sub {
      font-family: var(--font-mono);
      font-size: .58rem;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: var(--muted-light);
      margin-top: 3px;
    }
    .status-chip {
      border: 1px solid var(--border-strong);
      background: var(--surface);
      border-radius: 2px;
      padding: 8px 14px;
      font-family: var(--font-mono);
      font-size: .68rem;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted-light);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-top: 3px solid var(--accent);
      border-radius: 2px;
      padding: 18px;
    }
    .card-title {
      margin: 0 0 12px;
      font-family: var(--font-mono);
      font-size: .7rem;
      letter-spacing: 3px;
      color: var(--muted-light);
      text-transform: uppercase;
    }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    input, button {
      border-radius: 2px;
      border: 1px solid var(--border-strong);
      background: var(--surface-accent);
      color: var(--text);
      padding: 10px 12px;
      font-family: var(--font-body);
      font-size: .84rem;
    }
    input:focus, button:focus { outline: 1px solid var(--accent); outline-offset: 1px; }
    button {
      cursor: pointer;
      background: var(--accent);
      border-color: var(--accent);
      color: #111;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .6px;
      font-size: .75rem;
    }
    button:hover { filter: brightness(1.03); }
    button:disabled { opacity: .65; cursor: not-allowed; }
    button.btn-danger {
      background: var(--error);
      border-color: var(--error);
      color: #fff;
    }
    button.btn-secondary {
      background: var(--surface-accent);
      border-color: var(--border-strong);
      color: var(--text);
    }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td {
      text-align: left;
      padding: 11px 8px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      vertical-align: middle;
    }
    th {
      color: var(--muted-light);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-family: var(--font-mono);
    }
    .mono { font-family: var(--font-mono); }
    .muted { color: var(--muted-light); font-size: 13px; }
    .error { color: var(--error); }
    .ok { color: var(--success); }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--border);
      background: rgba(0,0,0,.12);
    }
    .hint {
      margin: 10px 0 0;
      line-height: 1.55;
    }
    @media (max-width: 840px) {
      .top { align-items: flex-start; flex-direction: column; }
      .status-chip { width: 100%; text-align: center; }
      table { min-width: 620px; }
    }
    @media (max-width: 640px) {
      .wrap { padding: 20px 12px 18px; }
      .card { padding: 14px; }
      table { min-width: 540px; }
      td .row { gap: 8px; }
      td .row input { min-width: 190px; flex: 1; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <div class="brand"><span>A</span>RK</div>
        <div class="brand-sub">Admin Control Node</div>
      </div>
      <div class="status-chip">Restricted Access</div>
    </div>

    <div class="grid">
    <div class="card">
      <h1 class="card-title">Admin Authentication</h1>
      <div class="row">
        <input id="password" type="password" placeholder="Admin password" style="min-width:260px" />
        <button id="load" type="button">Load Users</button>
      </div>
      <p class="muted hint">This endpoint is intentionally hidden. Access requires the worker env var <span class="mono">ADMIN_PASSWORD</span>.</p>
      <p class="muted hint">Use only over HTTPS.</p>
      <p id="status" class="muted hint" style="min-height:18px"></p>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 class="card-title" style="margin:0">User Capacity Controls</h2>
        <span id="count" class="muted">0 users</span>
      </div>
      <div class="table-wrap" style="margin-top:10px">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Used</th>
              <th>Limit</th>
              <th>Set new limit (GB or unlimited)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="users-body">
            <tr><td colspan="5" class="muted">Enter password and load users.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    </div>
  </div>

  <script>
    let adminPassword = '';
    let users = [];

    const GB = 1073741824;
    const LOAD_USERS_TIMEOUT_MS = 15000;
    const UNLIMITED_STORAGE_ALIASES = ['unlimited', '∞', 'inf', 'infinite'];
    const isUnlimitedStorage = (bytes) => Number(bytes) < 0;
    function formatStorage(bytes) {
      if (isUnlimitedStorage(bytes)) return 'Unlimited';
      const n = Number.isFinite(Number(bytes)) ? Math.max(0, Number(bytes)) : 0;
      if (n >= 1024 * GB) return (n / (1024 * GB)).toFixed(2) + ' TB';
      if (n >= GB) return (n / GB).toFixed(2) + ' GB';
      if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
      if (n >= 1024) return (n / 1024).toFixed(2) + ' KB';
      return n.toFixed(0) + ' B';
    }
    const esc = (v) => String(v || '').replace(/[&<>"'\u0060]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '\u0060':'&#96;' }[ch]));

    function setStatus(message, type = 'muted') {
      const el = document.getElementById('status');
      el.textContent = message || '';
      el.className = type;
    }

    function renderUsers() {
      const body = document.getElementById('users-body');
      document.getElementById('count').textContent = String(users.length) + ' user' + (users.length === 1 ? '' : 's');

      if (!users.length) {
        body.innerHTML = '<tr><td colspan="5" class="muted">No users found.</td></tr>';
        return;
      }

      body.innerHTML = users.map((u) => {
        const id = esc(u.id);
        const capUnlimited = isUnlimitedStorage(u.storage_cap);
        const limitGb = capUnlimited ? 'unlimited' : Number((Number(u.storage_cap || 0) / GB).toFixed(2));
        return '<tr>' +
          '<td>' + esc(u.email || '-') + '</td>' +
          '<td class="mono">' + formatStorage(u.storage_used) + '</td>' +
          '<td class="mono">' + formatStorage(u.storage_cap) + '</td>' +
          '<td><div class="row">' +
          '<input type="text" inputmode="text" aria-label="Storage limit in GB or unlimited" placeholder="1024 or unlimited" value="' + esc(limitGb) + '" data-cap="' + id + '" />' +
          '<button type="button" data-save="' + id + '">Save</button>' +
          '</div></td>' +
          '<td><div class="row">' +
          '<button type="button" class="btn-secondary" data-purge="' + id + '" data-email="' + esc(u.email || '') + '">Purge Files</button>' +
          '<button type="button" class="btn-danger" data-delete="' + id + '" data-email="' + esc(u.email || '') + '">Delete Account</button>' +
          '</div></td>' +
          '</tr>';
      }).join('');

      body.querySelectorAll('button[data-save]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const userId = btn.getAttribute('data-save');
          const input = body.querySelector('input[data-cap="' + CSS.escape(userId) + '"]');
          const raw = String((input && input.value) || '').trim();
          const lower = raw.toLowerCase();
          let payload;
          if (UNLIMITED_STORAGE_ALIASES.includes(lower)) {
            payload = { userId, storageCapUnlimited: true };
          } else {
            const capGb = Number(raw);
            if (!Number.isFinite(capGb) || capGb < 0) {
              setStatus('Storage limit must be a non-negative number or "unlimited".', 'error');
              return;
            }
            payload = { userId, storageCapGb: capGb };
          }

          btn.disabled = true;
          try {
            const res = await fetch('/admin/users/storage-limit', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + adminPassword,
              },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed');
            setStatus('Storage limit updated.', 'ok');
            await loadUsers();
          } catch (err) {
            setStatus(err.message || 'Update failed', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });

      body.querySelectorAll('button[data-purge]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const userId = btn.getAttribute('data-purge');
          const email = btn.getAttribute('data-email') || userId;
          if (!confirm('Purge ALL files for ' + email + '?\\n\\nThis will delete every file from storage. The account will remain. This cannot be undone.')) return;
          btn.disabled = true;
          try {
            const res = await fetch('/admin/users/purge-files', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + adminPassword,
              },
              body: JSON.stringify({ userId }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Purge failed');
            setStatus('Files purged for ' + email + '.', 'ok');
            await loadUsers();
          } catch (err) {
            setStatus(err.message || 'Purge failed', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });

      body.querySelectorAll('button[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const userId = btn.getAttribute('data-delete');
          const email = btn.getAttribute('data-email') || userId;
          if (!confirm('Permanently delete account for ' + email + '?\\n\\nThis will delete all files AND the account. This cannot be undone.')) return;
          btn.disabled = true;
          try {
            const res = await fetch('/admin/users/delete', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + adminPassword,
              },
              body: JSON.stringify({ userId }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Delete failed');
            setStatus('Account deleted for ' + email + '.', 'ok');
            await loadUsers();
          } catch (err) {
            setStatus(err.message || 'Delete failed', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });
    }

    async function loadUsers() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LOAD_USERS_TIMEOUT_MS);
      try {
        const res = await fetch('/admin/users', {
          headers: { Authorization: 'Bearer ' + adminPassword },
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load users');
        users = Array.isArray(data.users) ? data.users : [];
        renderUsers();
        setStatus('Loaded users.', 'ok');
      } catch (err) {
        users = [];
        renderUsers();
        const errName = err && typeof err === 'object' ? err.name : '';
        let message = 'Failed to load users';
        if (errName === 'AbortError') {
          message = 'Request timed out while loading users.';
        } else if (err instanceof Error && err.message) {
          message = err.message;
        }
        setStatus(message, 'error');
      } finally {
        clearTimeout(timeout);
      }
    }

    const loadBtn = document.getElementById('load');
    const passwordInput = document.getElementById('password');
    async function handleLoadClick() {
      adminPassword = passwordInput.value.trim();
      if (!adminPassword) {
        setStatus('Enter admin password first.', 'error');
        return;
      }
      setStatus('Loading users...');
      loadBtn.disabled = true;
      try {
        await loadUsers();
      } finally {
        loadBtn.disabled = false;
      }
    }
    loadBtn.addEventListener('click', handleLoadClick);
    passwordInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      handleLoadClick();
    });
  </script>
</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function listAdminUsers(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;

  const users = await sbGet(env, 'users?select=id,email,storage_used,storage_cap,created_at&order=created_at.desc');
  return jsonOk({ users });
}

async function updateUserStorageLimit(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');

  const storageCapBytes = parseStorageCapBytes(body);
  if (storageCapBytes === null) return jsonError('Provide storageCapGb/storageCapBytes as a non-negative number, or set storageCapUnlimited', 400, 'invalid_storage_limit');

  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email,storage_used,storage_cap`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');

  const current = users[0];
  if (storageCapBytes >= 0 && storageCapBytes < Number(current.storage_used || 0)) {
    return jsonError('New limit cannot be below current storage usage', 400, 'limit_below_usage');
  }

  const updated = await sbPatch(env, `users?id=eq.${enc(userId)}`, { storage_cap: storageCapBytes });
  return jsonOk({ user: updated[0] || { ...current, storage_cap: storageCapBytes } });
}

async function deleteUserFiles(userId, env) {
  const files = await sbGet(env, `files?user_id=eq.${enc(userId)}&select=id,message_id`);
  await Promise.allSettled(
    files.map((f) =>
      fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.CHAT_ID, message_id: f.message_id }),
      })
    )
  );
  if (files.length) {
    await sbDelete(env, `files?user_id=eq.${enc(userId)}`);
  }
  return files.length;
}

async function adminPurgeUserFiles(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');

  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');

  const purged = await deleteUserFiles(userId, env);
  await sbPatch(env, `users?id=eq.${enc(userId)}`, { storage_used: 0 });

  return jsonOk({ purged });
}

async function adminDeleteUser(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');

  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');

  const filesRemoved = await deleteUserFiles(userId, env);
  await sbDelete(env, `users?id=eq.${enc(userId)}`);

  return jsonOk({ deleted: true, filesRemoved });
}

function parseStorageCapBytes(body) {
  if (body && body.storageCapUnlimited === true) {
    return UNLIMITED_STORAGE_CAP;
  }

  if (body && UNLIMITED_STORAGE_ALIASES.includes(String(body.storageCap || '').trim().toLowerCase())) {
    return UNLIMITED_STORAGE_CAP;
  }

  if (body && Number.isFinite(Number(body.storageCapBytes))) {
    const bytes = Math.round(Number(body.storageCapBytes));
    return bytes >= 0 ? bytes : null;
  }

  if (body && Number.isFinite(Number(body.storageCapGb))) {
    const gb = Number(body.storageCapGb);
    if (gb < 0) return null;
    return Math.round(gb * GB);
  }

  return null;
}

async function requireAdmin(request, env) {
  const reqUrl = new URL(request.url);
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').toLowerCase();
  const isHttps = reqUrl.protocol === 'https:' || forwardedProto === 'https';
  const isLocalDev = reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1';
  if (!isHttps && !isLocalDev) {
    return jsonError('Admin access requires HTTPS', 400, 'https_required');
  }

  const configured = String(env.ADMIN_PASSWORD || '');
  if (!configured) return jsonError('ADMIN_PASSWORD is not configured', 500, 'admin_not_configured');

  const authHeader = String(request.headers.get('Authorization') || '');
  const suppliedFromBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const supplied = String(suppliedFromBearer || request.headers.get('X-Admin-Password') || '');
  if (!safeEqual(supplied, configured)) {
    return jsonError('Unauthorized', 401, 'unauthorized_admin');
  }

  return null;
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function register(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) return jsonError('Email and password are required', 400, 'invalid_input');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('Invalid email address', 400, 'invalid_email');
  if (password.length < 8) return jsonError('Password must be at least 8 characters', 400, 'invalid_password');

  const existing = await sbGet(env, `users?email=eq.${enc(email)}&select=id`);
  if (existing.length > 0) return jsonError('Email already registered', 409, 'email_taken');

  const passwordHash = await hashPassword(password);

  const created = await sbPost(env, 'users', {
    email,
    password_hash: passwordHash,
    storage_used: 0,
    storage_cap: BASE_STORAGE,
  });

  if (!created?.length) return jsonError('Account creation failed', 500, 'account_creation_failed');
  const user = created[0];

  const token = await makeJWT({ userId: user.id, email: user.email }, env.JWT_SECRET);
  return jsonOk({ token, email: user.email });
}

async function login(request, env) {
  const { email = '', password = '' } = await request.json().catch(() => ({}));
  const normalizedEmail = String(email).trim().toLowerCase();
  const users = await sbGet(env, `users?email=eq.${enc(normalizedEmail)}&select=*`);
  if (!users.length || !(await verifyPassword(password, users[0].password_hash))) {
    return jsonError('Invalid credentials', 401, 'invalid_credentials');
  }
  const user = users[0];
  const token = await makeJWT({ userId: user.id, email: user.email }, env.JWT_SECRET);
  return jsonOk({ token, email: user.email, storage_used: user.storage_used, storage_cap: user.storage_cap });
}

async function getMe(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=*`);
  return users.length ? jsonOk(users[0]) : jsonError('User not found', 404, 'user_not_found');
}

function normalizePaymentCurrency(currency) {
  const value = String(currency || '').trim().toUpperCase();
  return ['BTC', 'LTC', 'XMR'].includes(value) ? value : '';
}

// FIX 1: lowercase the hash so mixed-case input from the frontend doesn't
// cause mempool.space / blockchair to reject it with HTTP 400.
function normalizeTransactionHash(transactionHash) {
  return String(transactionHash || '').trim().toLowerCase();
}

// FIX 2: validate the hash is a proper 64-char hex string before hitting
// any external API or writing anything to the database.
function isValidTransactionHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
}

function isTestModeBypassHash(transactionHash, env) {
  const enabled = String(env?.ENABLE_TEST_MODE || '').toLowerCase() === 'true'; // REMOVE BEFORE GOING LIVE
  return enabled && String(transactionHash || '').trim().toUpperCase() === TEST_MODE_BYPASS_HASH;
}

function tierConfigFromEnv(env) {
  const raw = String(env.PAYMENT_TIER_CONFIG || '').trim();
  if (!raw) return DEFAULT_TIER_CONFIG;
  const parsed = safeJson(raw);
  return parsed && typeof parsed === 'object' ? parsed : DEFAULT_TIER_CONFIG;
}

function resolveTierConfig(env, tierName) {
  const normalizedTier = String(tierName || '').trim().toLowerCase();
  if (!normalizedTier) return null;
  const tiers = tierConfigFromEnv(env);
  const tier = tiers[normalizedTier];
  if (!tier) return null;
  const priceEur = Number(tier.priceEur);
  const storageLimit = Math.round(Number(tier.storageLimit));
  if (!Number.isFinite(priceEur) || priceEur < 0 || !Number.isFinite(storageLimit)) return null;
  return { name: normalizedTier, priceEur, storageLimit };
}

async function fetchCryptoRateEur(currency) {
  const coinIdMap = { BTC: 'bitcoin', LTC: 'litecoin' };
  const coinId = coinIdMap[currency] || '';
  if (!coinId) throw new Error('Unsupported rate lookup currency');
  const now = Date.now();
  const cached = RATE_CACHE.get(coinId);
  if (cached && cached.expiresAt > now) return cached.value;

  const rateData = await fetchJsonFromApi(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=eur`,
    'Failed to fetch exchange rate'
  );
  const eurRate = Number(rateData?.[coinId]?.eur);
  if (!Number.isFinite(eurRate) || eurRate <= 0) throw new Error('Invalid exchange rate response');
  RATE_CACHE.set(coinId, { value: eurRate, expiresAt: now + RATE_CACHE_TTL_MS });
  return eurRate;
}

function btcAmountToCoin(amountInSmallestUnit) {
  return Number(amountInSmallestUnit || 0) / 10 ** CRYPTO_DECIMALS;
}

function getBtcReceivedAmount(txData, walletAddress) {
  const outputs = Array.isArray(txData?.vout) ? txData.vout : [];
  const normalizedWalletAddress = String(walletAddress || '').toLowerCase();
  return outputs.reduce((sum, output) => {
    if (String(output?.scriptpubkey_address || '').toLowerCase() !== normalizedWalletAddress) return sum;
    return sum + btcAmountToCoin(output?.value);
  }, 0);
}

function getLtcReceivedAmount(txData, transactionHash, walletAddress) {
  const tx = txData?.data?.[transactionHash] || {};
  const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
  return outputs.reduce((sum, output) => {
    if (String(output?.recipient || '').toLowerCase() !== String(walletAddress).toLowerCase()) return sum;
    return sum + btcAmountToCoin(output?.value);
  }, 0);
}

// FIX 3: removed enc() around transactionHash in the URLs — the hash is
// already validated as pure hex (no special chars), and enc() was
// percent-encoding characters that caused the APIs to reject the request.
async function fetchReceivedAmount(currency, transactionHash, walletAddress) {
  if (currency === 'BTC') {
    const txData = await fetchJsonFromApi(
      `https://mempool.space/api/tx/${transactionHash}`,
      'Unable to fetch BTC transaction'
    );
    return getBtcReceivedAmount(txData, walletAddress);
  }
  if (currency === 'LTC') {
    const txData = await fetchJsonFromApi(
      `https://blockchair.com/litecoin/dashboards/transaction/${transactionHash}`,
      'Unable to fetch LTC transaction'
    );
    return getLtcReceivedAmount(txData, transactionHash, walletAddress);
  }
  throw new Error('Unsupported currency');
}

async function ensurePaymentNotProcessed(env, transactionHash) {
  const existing = await sbGet(env, `payments?transaction_hash=eq.${enc(transactionHash)}&select=id,status,transaction_hash`);
  if (existing.length) return jsonError('Transaction hash already processed', 409, 'transaction_already_processed');
  return null;
}

async function claimPayment(env, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/payments?on_conflict=transaction_hash`, {
    method: 'POST',
    headers: { ...sbHeaders(env), Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json().catch(() => []);
  return rows[0] || null;
}

async function fetchJsonFromApi(url, defaultErrorMessage) {
  let lastError = null;
  for (let attempt = 0; attempt <= EXTERNAL_API_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const errorBody = (await response.text().catch(() => '')).slice(0, EXTERNAL_ERROR_BODY_MAX_LENGTH);
        throw new Error(`${defaultErrorMessage}: HTTP ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
      }
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(`${defaultErrorMessage}: empty or malformed JSON response from external API`);
      return data;
    } catch (err) {
      lastError = err;
      if (attempt === EXTERNAL_API_RETRIES) throw new Error(lastError?.message || defaultErrorMessage);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error(lastError?.message || defaultErrorMessage);
}

async function verifyPayment(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const tierName = String(body.tierName || '').trim();
  const currency = normalizePaymentCurrency(body.currency);
  const transactionHash = normalizeTransactionHash(body.transactionHash);

  if (!userId || !tierName || !currency || !transactionHash) {
    return jsonError('userId, tierName, currency, and transactionHash are required', 400, 'missing_payment_fields');
  }

  // FIX 2 (applied): reject malformed hashes before touching the DB or any external API.
  // The test mode bypass hash is intentionally not a valid hex string, so skip validation for it.
  const isBypass = isTestModeBypassHash(transactionHash, env); // REMOVE BEFORE GOING LIVE
  if (!isBypass && !isValidTransactionHash(transactionHash)) {
    return jsonError('Invalid transaction hash — must be a 64-character hex string', 400, 'invalid_transaction_hash');
  }

  if (auth.userId !== userId) return jsonError('Forbidden', 403, 'forbidden');

  const duplicateError = await ensurePaymentNotProcessed(env, transactionHash);
  if (duplicateError) return duplicateError;

  const tier = resolveTierConfig(env, tierName);
  if (!tier) return jsonError('Unknown tierName or invalid tier config', 400, 'invalid_tier');
  const claimed = await claimPayment(env, {
    user_id: userId,
    tier_name: tier.name,
    currency,
    transaction_hash: transactionHash,
    status: 'processing',
  });
  if (!claimed) return jsonError('Transaction hash already processed', 409, 'transaction_already_processed');

  // ===== TEST MODE BYPASS (REMOVE BEFORE GOING LIVE) =====
  if (isBypass) {
    const updatedProfile = await sbPatch(env, `users?id=eq.${enc(userId)}`, { storage_cap: tier.storageLimit });
    if (!updatedProfile.length) {
      await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, { status: 'failed_profile_not_found' });
      return jsonError('Profile not found', 404, 'profile_not_found');
    }
    await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, {
      status: 'used_test_bypass_remove_before_live',
      status_reason: 'remove_before_live',
      wallet_address: 'TEST_MODE_BYPASS_REMOVE_BEFORE_LIVE',
    });
    return jsonOk({
      verified: true,
      testModeBypass: true,
      currency,
      tierName: tier.name,
      storageLimit: tier.storageLimit,
      transactionHash,
    });
  }
  // ===== END TEST MODE BYPASS =====

  if (currency === 'XMR') {
    await sbPost(env, 'manual_verifications', {
      user_id: userId,
      tier_name: tier.name,
      currency,
      transaction_hash: transactionHash,
      status: 'Pending',
      wallet_address: PAYMENT_WALLETS.XMR,
    });
    await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, {
      status: 'pending_manual',
      wallet_address: PAYMENT_WALLETS.XMR,
    });
    return jsonOk({ status: 'pending', manualReview: true });
  }

  const walletAddress = PAYMENT_WALLETS[currency];
  const receivedAmount = await fetchReceivedAmount(currency, transactionHash, walletAddress);
  const eurRate = await fetchCryptoRateEur(currency);
  const requiredAmount = tier.priceEur / eurRate;
  if (receivedAmount + PAYMENT_TOLERANCE < requiredAmount) {
    await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, { status: 'rejected_insufficient_amount' });
    return jsonError('Payment amount or wallet output does not match tier price', 400, 'payment_not_verified');
  }

  const updatedProfile = await sbPatch(env, `users?id=eq.${enc(userId)}`, { storage_cap: tier.storageLimit });
  if (!updatedProfile.length) {
    await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, { status: 'failed_profile_not_found' });
    return jsonError('Profile not found', 404, 'profile_not_found');
  }

  const receivedAmountUnits = Math.round(receivedAmount * 10 ** CRYPTO_DECIMALS);
  const requiredAmountUnits = Math.round(requiredAmount * 10 ** CRYPTO_DECIMALS);
  await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, {
    wallet_address: walletAddress,
    amount_received_units: receivedAmountUnits,
    amount_required_units: requiredAmountUnits,
    amount_received: Number(receivedAmount.toFixed(CRYPTO_DECIMALS)),
    amount_required: Number(requiredAmount.toFixed(CRYPTO_DECIMALS)),
    status: 'used',
  });

  return jsonOk({
    verified: true,
    currency,
    tierName: tier.name,
    storageLimit: tier.storageLimit,
    transactionHash,
  });
}

async function uploadFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file) return jsonError('File is required', 400, 'missing_file');
  if (file.size > FILE_LIMIT) return jsonError('File exceeds 2GB limit', 413, 'file_too_large');

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=storage_used,storage_cap`);
  const u = users[0];
  if (!u) return jsonError('User not found', 404, 'user_not_found');
  const cap = Number(u.storage_cap);
  const isUnlimited = Number.isFinite(cap) && cap < 0;
  if (!isUnlimited && (u.storage_used || 0) + file.size > (u.storage_cap || 0)) {
    return jsonError('Storage full', 413, 'storage_full');
  }

  // --- Upload via Hugging Face bridge (MTProto, supports up to 2GB) ---
  const bridgeForm = new FormData();
  bridgeForm.append('file', file, file.name);

  const bridgeRes = await fetch(`${env.BRIDGE_URL}/upload`, {
    method: 'POST',
    headers: {
      'x-bridge-secret': env.BRIDGE_SECRET,
      'x-user-email': auth.email,
    },
    body: bridgeForm,
  });

  if (!bridgeRes.ok) {
    const err = await bridgeRes.json().catch(() => ({}));
    return jsonError(err.detail || 'Upload bridge failed', 502, 'bridge_upload_failed');
  }

  const bridgeData = await bridgeRes.json();
  const fileId = bridgeData.file_id;
  const messageId = bridgeData.message_id;

  if (!fileId || !messageId) {
    return jsonError('Bridge returned incomplete data', 502, 'bridge_invalid_response');
  }
  // --- End bridge upload ---

  const saved = await sbPost(env, 'files', {
    user_id: auth.userId,
    name: file.name,
    size: file.size,
    type: file.type,
    file_id: fileId,
    message_id: messageId,
  });

  await sbPatch(env, `users?id=eq.${auth.userId}`, { storage_used: (u.storage_used || 0) + file.size });
  return jsonOk({ file: saved[0] });
}

async function listFiles(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  const files = await sbGet(env, `files?user_id=eq.${auth.userId}&order=uploaded_at.desc&select=*`);
  return jsonOk({ files });
}

async function downloadFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  if (!fileId) return jsonError('fileId required', 400, 'missing_file_id');

  const files = await sbGet(env, `files?file_id=eq.${enc(fileId)}&user_id=eq.${auth.userId}&select=id,name,type`);
  if (files.length === 0) return jsonError('Access denied', 404, 'file_not_found');
  const file = files[0];

  const tgRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const tgData = await tgRes.json();
  if (!tgData.ok) return jsonError(tgData.description || 'Telegram fetch failed', 502, 'telegram_get_file_failed');

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${encodeURIComponent(env.BOT_TOKEN)}/${tgData.result.file_path}`);
  if (!fileResponse.ok) return jsonError('Telegram file download failed', 502, 'telegram_download_failed');

  const filename = file.name ? String(file.name) : 'download.bin';
  return new Response(fileResponse.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': fileResponse.headers.get('Content-Type') || file.type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${enc(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

async function viewFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  if (!fileId) return jsonError('fileId required', 400, 'missing_file_id');

  const files = await sbGet(env, `files?file_id=eq.${enc(fileId)}&user_id=eq.${auth.userId}&select=id,name,type`);
  if (files.length === 0) return jsonError('Access denied', 404, 'file_not_found');
  const file = files[0];
  if (!isPreviewableMediaFile(file)) return jsonError('File type cannot be previewed', 415, 'preview_not_supported');

  const tgRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const tgData = await tgRes.json();
  if (!tgData.ok) return jsonError(tgData.description || 'Telegram fetch failed', 502, 'telegram_get_file_failed');

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${encodeURIComponent(env.BOT_TOKEN)}/${tgData.result.file_path}`);
  if (!fileResponse.ok) return jsonError('Telegram file download failed', 502, 'telegram_download_failed');

  const upstreamContentType = fileResponse.headers.get('Content-Type') || file.type || 'application/octet-stream';
  const guessedMediaType = guessPreviewContentType(file.name);
  const contentType = isPreviewContentType(upstreamContentType)
    ? upstreamContentType
    : (guessedMediaType || upstreamContentType);
  if (!isPreviewContentType(contentType)) {
    return jsonError('File type cannot be previewed', 415, 'preview_not_supported');
  }

  const filename = file.name ? String(file.name) : 'media';
  return new Response(fileResponse.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${enc(filename)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function deleteFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const { fileRecordId } = await request.json().catch(() => ({}));
  if (!fileRecordId) return jsonError('fileRecordId required', 400, 'missing_file_record_id');

  const files = await sbGet(env, `files?id=eq.${fileRecordId}&user_id=eq.${auth.userId}&select=*`);
  if (!files.length) return jsonError('File not found', 404, 'file_not_found');
  const file = files[0];

  await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.CHAT_ID, message_id: file.message_id }),
  }).catch(() => {
    // Deletion is best-effort because the file record should still be removed if Telegram cleanup fails.
  });

  await sbDelete(env, `files?id=eq.${fileRecordId}`);

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=storage_used`);
  if (users.length) {
    await sbPatch(env, `users?id=eq.${auth.userId}`, {
      storage_used: Math.max(0, (users[0].storage_used || 0) - (file.size || 0)),
    });
  }

  return jsonOk({ deleted: true });
}

const sbHeaders = (env) => ({
  apikey: env.SUPABASE_KEY,
  Authorization: `Bearer ${env.SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function sbGet(env, q) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: sbHeaders(env) });
  return r.ok ? r.json() : Promise.reject(new Error(await r.text()));
}

async function sbPost(env, table, data) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  return r.ok ? r.json() : Promise.reject(new Error(await r.text()));
}

async function sbPatch(env, q, data) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  return r.ok ? r.json() : Promise.reject(new Error(await r.text()));
}

async function sbDelete(env, q) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, {
    method: 'DELETE',
    headers: sbHeaders(env),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function makeJWT(payload, secret) {
  const encb64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const head = encb64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encb64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS }));
  const data = `${head}.${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${encb64(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBuf = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(`${h}.${p}`));
    const decoded = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    return ok && decoded.exp > Date.now() / 1000 ? decoded : null;
  } catch {
    return null;
  }
}

async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? verifyJWT(auth.slice(7), env.JWT_SECRET) : null;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []), (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  const check = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return check === hashHex;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function enc(s) {
  return encodeURIComponent(String(s));
}

const PREVIEW_MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
};

function previewExtensionFor(name = '') {
  const lower = String(name).toLowerCase().trim();
  if (!lower.includes('.')) return '';
  const ext = lower.split('.').pop();
  return PREVIEW_MIME_BY_EXTENSION[ext] ? ext : '';
}

function isPreviewableMediaFile(file = {}) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
  return Boolean(previewExtensionFor(file?.name || ''));
}

function guessPreviewContentType(name = '') {
  const ext = previewExtensionFor(name);
  return ext ? PREVIEW_MIME_BY_EXTENSION[ext] : '';
}

function isPreviewContentType(contentType = '') {
  const mime = String(contentType || '').toLowerCase();
  return mime.startsWith('image/') || mime.startsWith('video/');
}

function jsonOk(data) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonError(message, status = 400, code = 'bad_request') {
  return new Response(JSON.stringify({ ok: false, error: message, code }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export const __testables = {
  enc,
  safeJson,
  parseStorageCapBytes,
  safeEqual,
  normalizePaymentCurrency,
  normalizeTransactionHash,
  isValidTransactionHash,
  isTestModeBypassHash,
  resolveTierConfig,
  getBtcReceivedAmount,
  getLtcReceivedAmount,
  isPreviewableMediaFile,
  guessPreviewContentType,
  isPreviewContentType,
};
