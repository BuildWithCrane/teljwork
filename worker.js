/* Cloudflare Worker */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://everfast.imgfiles.net',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
};

const GB = 1073741824;
const UNLIMITED_STORAGE_CAP = -1;
const UNLIMITED_STORAGE_ALIASES = ['unlimited', '∞', 'inf', 'infinite'];
const BASE_STORAGE = 50 * GB;
const FILE_LIMIT = 20 * 1024 * 1024;
const JWT_EXPIRY_SECONDS = 86400 * 30;
const PBKDF2_ITERATIONS = 100000;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/admin' && request.method === 'GET') return serveAdminPage();
      if (pathname === '/admin/users' && request.method === 'GET') return listAdminUsers(request, env);
      if (pathname === '/admin/users/storage-limit' && request.method === 'POST') return updateUserStorageLimit(request, env);

      if (pathname === '/auth/register' && request.method === 'POST') return register(request, env);
      if (pathname === '/auth/login' && request.method === 'POST') return login(request, env);
      if (pathname === '/auth/me' && request.method === 'GET') return getMe(request, env);

      if (pathname === '/files/upload' && request.method === 'POST') return uploadFile(request, env);
      if (pathname === '/files' && request.method === 'GET') return listFiles(request, env);
      if (pathname === '/files/download' && request.method === 'GET') return downloadFile(request, env);
      if (pathname === '/files/view' && request.method === 'GET') return viewFile(request, env);
      if (pathname === '/files/delete' && request.method === 'POST') return deleteFile(request, env);

      return jsonError('Not found', 404, 'not_found');
    } catch (err) {
      return jsonError(`Server error: ${err.message}`, 500, 'server_error');
    }
  }
};

function serveAdminPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #020617; color: #f8fafc; font-family: Inter, system-ui, -apple-system, sans-serif; }
    .wrap { max-width: 980px; margin: 32px auto; padding: 0 16px; }
    .card { background: #0f172a; border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    input, button { border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: #1e293b; color: #fff; padding: 10px 12px; }
    button { cursor: pointer; background: #2563eb; border-color: #2563eb; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 14px; }
    th { color: #94a3b8; font-size: 12px; text-transform: uppercase; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .muted { color: #94a3b8; font-size: 13px; }
    .error { color: #f87171; }
    .ok { color: #34d399; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1 style="margin:0 0 12px;font-size:20px">Admin Console</h1>
      <div class="row">
        <input id="password" type="password" placeholder="Admin password" style="min-width:260px" />
        <button id="load">Load users</button>
      </div>
      <p class="muted" style="margin:10px 0 0">This page is intentionally hidden. Access requires the worker env var <span class="mono">ADMIN_PASSWORD</span>.</p>
      <p class="muted" style="margin:8px 0 0">Use only over HTTPS.</p>
      <p id="status" class="muted" style="min-height:18px;margin:10px 0 0"></p>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <strong>Users</strong>
        <span id="count" class="muted">0 users</span>
      </div>
      <div style="overflow:auto;margin-top:10px">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Used</th>
              <th>Limit</th>
              <th>Set new limit (GB or unlimited)</th>
            </tr>
          </thead>
          <tbody id="users-body">
            <tr><td colspan="4" class="muted">Enter password and load users.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    let adminPassword = '';
    let users = [];

    const GB = 1073741824;
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
    const esc = (v) => String(v || '').replace(/[&<>"'\`]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '\`':'&#96;' }[ch]));

    function setStatus(message, type = 'muted') {
      const el = document.getElementById('status');
      el.textContent = message || '';
      el.className = type;
    }

    function renderUsers() {
      const body = document.getElementById('users-body');
      document.getElementById('count').textContent = String(users.length) + ' user' + (users.length === 1 ? '' : 's');

      if (!users.length) {
        body.innerHTML = '<tr><td colspan="4" class="muted">No users found.</td></tr>';
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
          '<button data-save="' + id + '">Save</button>' +
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
    }

    async function loadUsers() {
      try {
        const res = await fetch('/admin/users', {
          headers: { Authorization: 'Bearer ' + adminPassword },
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load users');
        users = Array.isArray(data.users) ? data.users : [];
        renderUsers();
        setStatus('Loaded users.', 'ok');
      } catch (err) {
        users = [];
        renderUsers();
        setStatus(err.message || 'Failed to load users', 'error');
      }
    }

    document.getElementById('load').addEventListener('click', async () => {
      adminPassword = document.getElementById('password').value;
      if (!adminPassword) {
        setStatus('Enter admin password first.', 'error');
        return;
      }
      setStatus('Loading users...');
      await loadUsers();
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

async function uploadFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file) return jsonError('File is required', 400, 'missing_file');
  if (file.size > FILE_LIMIT) return jsonError('File exceeds 20MB limit', 413, 'file_too_large');

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=storage_used,storage_cap`);
  const u = users[0];
  if (!u) return jsonError('User not found', 404, 'user_not_found');
  const cap = Number(u.storage_cap);
  const isUnlimited = Number.isFinite(cap) && cap < 0;
  if (!isUnlimited && (u.storage_used || 0) + file.size > (u.storage_cap || 0)) return jsonError('Storage full', 413, 'storage_full');

  const tgForm = new FormData();
  tgForm.append('chat_id', env.CHAT_ID);
  tgForm.append('caption', `👤 ${auth.email}\n📁 ${file.name}`);

  let method = 'sendDocument';
  const type = file.type || '';
  if (type.startsWith('image/') && !file.name.endsWith('.gif')) method = 'sendPhoto';
  else if (type.startsWith('video/')) method = 'sendVideo';
  else if (type.startsWith('audio/')) method = 'sendAudio';

  const keyMap = { sendPhoto: 'photo', sendVideo: 'video', sendAudio: 'audio' };
  const key = keyMap[method] || 'document';
  tgForm.append(key, file, file.name);

  const tgRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/${method}`, { method: 'POST', body: tgForm });
  const tgData = await tgRes.json();
  if (!tgData.ok) return jsonError('Telegram upload failed', 502, 'telegram_upload_failed');

  const msg = tgData.result;
  const largestPhotoFileId = Array.isArray(msg.photo) && msg.photo.length > 0 ? msg.photo[msg.photo.length - 1].file_id : null;
  const fileId = msg.document?.file_id || msg.video?.file_id || msg.audio?.file_id || largestPhotoFileId;
  const saved = await sbPost(env, 'files', {
    user_id: auth.userId,
    name: file.name,
    size: file.size,
    type: file.type,
    file_id: fileId,
    message_id: msg.message_id,
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

  const filename = file.name ? String(file.name) : 'media.bin';
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
  isPreviewableMediaFile,
  guessPreviewContentType,
  isPreviewContentType,
};
