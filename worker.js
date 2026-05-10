/* Cloudflare Worker */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://storage.jwork.ru',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const GB = 1073741824;
const BASE_STORAGE = 100 * GB;
const FILE_LIMIT = 20 * 1024 * 1024;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/auth/register' && request.method === 'POST') return register(request, env);
      if (pathname === '/auth/login' && request.method === 'POST') return login(request, env);
      if (pathname === '/auth/me' && request.method === 'GET') return getMe(request, env);

      if (pathname === '/files/upload' && request.method === 'POST') return uploadFile(request, env);
      if (pathname === '/files' && request.method === 'GET') return listFiles(request, env);
      if (pathname === '/files/download' && request.method === 'GET') return downloadFile(request, env);
      if (pathname === '/files/delete' && request.method === 'POST') return deleteFile(request, env);

      return jsonError('Not found', 404, 'not_found');
    } catch (err) {
      return jsonError(`Server error: ${err.message}`, 500, 'server_error');
    }
  }
};

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
  if (!file || file.size > FILE_LIMIT) return jsonError('File exceeds 20MB limit', 413, 'file_too_large');

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=storage_used,storage_cap`);
  const u = users[0];
  if (!u) return jsonError('User not found', 404, 'user_not_found');
  if ((u.storage_used || 0) + file.size > (u.storage_cap || 0)) return jsonError('Storage full', 413, 'storage_full');

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

  const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', body: tgForm });
  const tgData = await tgRes.json();
  if (!tgData.ok) return jsonError('Telegram upload failed', 502, 'telegram_upload_failed');

  const msg = tgData.result;
  const photoFileId = Array.isArray(msg.photo) && msg.photo.length > 0 ? msg.photo[msg.photo.length - 1].file_id : null;
  const fileId = msg.document?.file_id || msg.video?.file_id || msg.audio?.file_id || photoFileId;
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

  const files = await sbGet(env, `files?file_id=eq.${enc(fileId)}&user_id=eq.${auth.userId}&select=id`);
  if (files.length === 0) return jsonError('Access denied', 404, 'file_not_found');

  const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const tgData = await tgRes.json();
  if (!tgData.ok) return jsonError(tgData.description || 'Telegram fetch failed', 502, 'telegram_get_file_failed');

  return jsonOk({ url: `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${tgData.result.file_path}` });
}

async function deleteFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const { fileRecordId } = await request.json().catch(() => ({}));
  if (!fileRecordId) return jsonError('fileRecordId required', 400, 'missing_file_record_id');

  const files = await sbGet(env, `files?id=eq.${fileRecordId}&user_id=eq.${auth.userId}&select=*`);
  if (!files.length) return jsonError('File not found', 404, 'file_not_found');
  const file = files[0];

  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.CHAT_ID, message_id: file.message_id }),
  }).catch(() => {});

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
  const body = encb64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 86400 * 30 }));
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
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []), (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
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
};
