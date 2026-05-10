/* Cloudflare Worker */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://storage.jwork.ru',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const GB = 1073741824;
const BASE_STORAGE = 10 * GB;
const PARTNER_BONUS_STORAGE = 25 * GB;
const REFERRAL_BONUS = 5 * GB;
const MAX_STORAGE = 100 * GB;
const FILE_LIMIT = 20 * 1024 * 1024;
const MAX_ACCOUNTS_PER_IP = 3;
const MAX_DATACENTER_REFERRALS = 5;
const PARTNER_CODES = ['MIGDNS25'];
const REFERRAL_COOLDOWN_HOURS = 24;
const REFERRAL_MILESTONES = [1, 3, 5, 10, 15, 20];

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

      if (pathname === '/referrals/track-click' && request.method === 'POST') return trackReferralClick(request, env);
      if (pathname === '/referrals/summary' && request.method === 'GET') return getReferralSummary(request, env);
      if (pathname === '/referrals/history' && request.method === 'GET') return getReferralHistory(request, env);
      if (pathname === '/referrals/milestones' && request.method === 'GET') return getReferralMilestones(request, env);

      return jsonError('Not found', 404, 'not_found');
    } catch (err) {
      return jsonError(`Server error: ${err.message}`, 500, 'server_error');
    }
  }
};

async function isDatacenterIP(ip) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=hosting`, { cf: { cacheTtl: 86400 } });
    const data = await res.json();
    return data.hosting === true;
  } catch {
    return false;
  }
}

async function register(request, env) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const referral_code = String(body.referral_code || '').trim();

  if (!username || !password) return jsonError('Username and password are required', 400, 'invalid_input');
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return jsonError('Username must be 3-32 chars: letters, numbers, underscore', 400, 'invalid_username');
  if (password.length < 8) return jsonError('Password must be at least 8 characters', 400, 'invalid_password');

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  const userAgentHash = await hashText(userAgent);

  const [ipAccounts, isHosting] = await Promise.all([
    ip !== 'unknown' ? sbGet(env, `users?signup_ip=eq.${enc(ip)}&select=id`) : Promise.resolve([]),
    ip !== 'unknown' ? isDatacenterIP(ip) : Promise.resolve(false),
  ]);

  if (ipAccounts.length >= MAX_ACCOUNTS_PER_IP) return jsonError('Account limit reached', 429, 'account_limit_reached');

  const existing = await sbGet(env, `users?username=eq.${enc(username)}&select=id`);
  if (existing.length > 0) return jsonError('Username taken', 409, 'username_taken');

  const passwordHash = await hashPassword(password);
  const myCode = generateCode();
  const upReferral = referral_code.toUpperCase();
  const startingCap = PARTNER_CODES.includes(upReferral) ? PARTNER_BONUS_STORAGE : BASE_STORAGE;

  let referredBy = null;
  let grantReferralBonus = true;
  let referralReason = 'qualified';

  if (referral_code) {
    const referrers = await sbGet(env, `users?referral_code=eq.${enc(upReferral)}&select=id,flagged,signup_ip,signup_ip_datacenter,storage_cap,referral_count`);
    if (referrers.length === 0) {
      return jsonError('Referral code not found', 400, 'invalid_referral_code');
    }

    const referrer = referrers[0];
    referredBy = referrer.id;

    const abuseReasons = [];
    if (referrer.flagged) abuseReasons.push('referrer_flagged');
    if (referrer.signup_ip && ip !== 'unknown' && referrer.signup_ip === ip) abuseReasons.push('same_ip');
    if (isHosting && referrer.signup_ip_datacenter) abuseReasons.push('datacenter_pair');

    const refHash = await readOptionalKV(env, `uafp:${referrer.id}`);
    if (refHash && refHash === userAgentHash) abuseReasons.push('same_device_fingerprint');

    if (ip !== 'unknown') {
      const cutoff = new Date(Date.now() - REFERRAL_COOLDOWN_HOURS * 3600 * 1000).toISOString();
      const sameIpRecent = await sbGet(env, `users?referred_by=eq.${referrer.id}&signup_ip=eq.${enc(ip)}&created_at=gte.${enc(cutoff)}&select=id`);
      if (sameIpRecent.length > 0) abuseReasons.push('same_ip_cooldown');
    }

    const datacenterReferrals = await sbGet(env, `users?referred_by=eq.${referrer.id}&signup_ip_datacenter=eq.true&select=id`);
    if (isHosting && datacenterReferrals.length >= MAX_DATACENTER_REFERRALS) abuseReasons.push('datacenter_referral_limit');

    if ((referrer.storage_cap || 0) >= MAX_STORAGE) abuseReasons.push('storage_cap_reached');

    if (abuseReasons.length > 0) {
      grantReferralBonus = false;
      referralReason = abuseReasons.join(',');
    }
  }

  const created = await sbPost(env, 'users', {
    username,
    password_hash: passwordHash,
    referral_code: myCode,
    referred_by: referredBy,
    storage_used: 0,
    storage_cap: startingCap,
    signup_ip: ip,
    signup_ip_datacenter: isHosting,
  });

  if (!created?.length) return jsonError('Account creation failed', 500, 'account_creation_failed');
  const user = created[0];

  await writeOptionalKV(env, `uafp:${user.id}`, userAgentHash);

  if (referredBy && grantReferralBonus) {
    const referrers = await sbGet(env, `users?id=eq.${referredBy}&select=storage_cap,referral_count`);
    if (referrers.length > 0) {
      const ref = referrers[0];
      await sbPatch(env, `users?id=eq.${referredBy}`, {
        storage_cap: Math.min((ref.storage_cap || BASE_STORAGE) + REFERRAL_BONUS, MAX_STORAGE),
        referral_count: (ref.referral_count || 0) + 1,
      });
    }
  }

  if (referredBy) {
    await writeOptionalKV(env, `refr:${user.id}`, JSON.stringify({
      qualified: grantReferralBonus,
      reason: referralReason,
      bonus_bytes: grantReferralBonus ? REFERRAL_BONUS : 0,
      created_at: new Date().toISOString(),
    }));
  }

  const token = await makeJWT({ userId: user.id, username: user.username }, env.JWT_SECRET);
  return jsonOk({
    token,
    username: user.username,
    referral_code: myCode,
    referral: {
      applied: Boolean(referredBy),
      qualified: grantReferralBonus,
      reason: referralReason,
    }
  });
}

async function login(request, env) {
  const { username = '', password = '' } = await request.json().catch(() => ({}));
  const users = await sbGet(env, `users?username=eq.${enc(username)}&select=*`);
  if (!users.length || !(await verifyPassword(password, users[0].password_hash))) {
    return jsonError('Invalid credentials', 401, 'invalid_credentials');
  }
  const user = users[0];
  const token = await makeJWT({ userId: user.id, username: user.username }, env.JWT_SECRET);
  return jsonOk({ token, username: user.username, storage_used: user.storage_used, storage_cap: user.storage_cap, referral_code: user.referral_code });
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
  tgForm.append('caption', `👤 ${auth.username}\n📁 ${file.name}`);

  let method = 'sendDocument';
  const type = file.type || '';
  if (type.startsWith('image/') && !file.name.endsWith('.gif')) method = 'sendPhoto';
  else if (type.startsWith('video/')) method = 'sendVideo';
  else if (type.startsWith('audio/')) method = 'sendAudio';

  const key = method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : method === 'sendAudio' ? 'audio' : 'document';
  tgForm.append(key, file, file.name);

  const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', body: tgForm });
  const tgData = await tgRes.json();
  if (!tgData.ok) return jsonError('Telegram upload failed', 502, 'telegram_upload_failed', tgData);

  const msg = tgData.result;
  const fileId = msg.document?.file_id || msg.video?.file_id || msg.audio?.file_id || msg.photo?.[msg.photo.length - 1]?.file_id;
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

async function trackReferralClick(request, env) {
  const { referral_code = '' } = await request.json().catch(() => ({}));
  const code = String(referral_code || '').trim().toUpperCase();
  if (!code) return jsonError('referral_code required', 400, 'missing_referral_code');

  const refs = await sbGet(env, `users?referral_code=eq.${enc(code)}&select=id`);
  if (refs.length === 0) return jsonError('Invalid referral code', 400, 'invalid_referral_code');

  await incrementOptionalKV(env, `refclick:${code}`);
  await incrementOptionalKV(env, 'refclick:total');

  return jsonOk({ tracked: true });
}

async function getReferralSummary(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=id,referral_code,referral_count,storage_cap`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  const user = users[0];

  const referred = await sbGet(env, `users?referred_by=eq.${auth.userId}&select=id`);
  const qualified = Number(user.referral_count || 0);
  const earnedBytes = Math.min(MAX_STORAGE, BASE_STORAGE + qualified * REFERRAL_BONUS) - BASE_STORAGE;
  const clicks = Number(await readOptionalKV(env, `refclick:${user.referral_code}`) || 0);

  return jsonOk({
    referral_code: user.referral_code,
    qualified_referrals: qualified,
    total_signups: referred.length,
    earned_storage_gb: earnedBytes / GB,
    current_storage_cap_gb: Number(user.storage_cap || 0) / GB,
    max_storage_gb: MAX_STORAGE / GB,
    remaining_to_max_gb: Math.max(0, MAX_STORAGE - Number(user.storage_cap || 0)) / GB,
    referral_clicks: clicks,
  });
}

async function getReferralHistory(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const rows = await sbGet(env, `users?referred_by=eq.${auth.userId}&order=created_at.desc&select=id,username,created_at`);
  const history = [];

  for (const row of rows) {
    const metaRaw = await readOptionalKV(env, `refr:${row.id}`);
    const meta = safeJson(metaRaw);
    history.push({
      id: row.id,
      username: row.username,
      created_at: row.created_at,
      qualified: Boolean(meta?.qualified),
      reason: meta?.reason || (metaRaw ? 'unknown' : 'legacy_record'),
      bonus_gb: Number(meta?.bonus_bytes || 0) / GB,
    });
  }

  return jsonOk({ history });
}

async function getReferralMilestones(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=referral_count`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');

  const count = Number(users[0].referral_count || 0);
  return jsonOk({ milestones: buildReferralMilestones(count) });
}

function buildReferralMilestones(count) {
  return REFERRAL_MILESTONES.map((required) => ({
    required_referrals: required,
    reached: count >= required,
    bonus_gb: required * (REFERRAL_BONUS / GB),
  }));
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

async function hashText(input) {
  const data = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function incrementOptionalKV(env, key) {
  if (!env.REFERRAL_KV) return;
  const cur = Number((await env.REFERRAL_KV.get(key)) || 0);
  await env.REFERRAL_KV.put(key, String(cur + 1));
}

async function readOptionalKV(env, key) {
  if (!env.REFERRAL_KV) return null;
  return env.REFERRAL_KV.get(key);
}

async function writeOptionalKV(env, key, value) {
  if (!env.REFERRAL_KV) return;
  await env.REFERRAL_KV.put(key, String(value));
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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

function jsonError(message, status = 400, code = 'bad_request', details = null) {
  return new Response(JSON.stringify({ ok: false, error: message, code, details }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export const __testables = {
  buildReferralMilestones,
  enc,
  safeJson,
};
