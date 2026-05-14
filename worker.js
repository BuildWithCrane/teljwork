/* Cloudflare Worker */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://ark.dockl.com',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
};
const ALLOWED_CORS_ORIGINS = new Set([
  'https://ark.dockl.com',
  'https://www.ark.dockl.com',
  'https://sparkling-math-0017.wgattr14.workers.dev',
]);

const GB = 1073741824;
const UNLIMITED_STORAGE_CAP = -1;
const UNLIMITED_STORAGE_ALIASES = ['unlimited', '\u221e', 'inf', 'infinite'];
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
const ADMIN_AUDIT_LOG_LIMIT = 300;
const ADMIN_AUDIT_LOGS = [];
const ADMIN_AUTH_ATTEMPTS = new Map();
const ADMIN_LOCKOUTS = new Map();
const ADMIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_MAX_FAILED_ATTEMPTS = 8;
const ADMIN_LOCKOUT_MS = 20 * 60 * 1000;
const SOFT_DISABLED_USERS = new Map();
const SESSION_STORE = new Map();
const REVOKED_SESSION_IDS = new Set();
const DAILY_BANDWIDTH_LIMITS = {
  starter: 10 * GB,
  pro: 100 * GB,
  creator: UNLIMITED_STORAGE_CAP,
  studio: UNLIMITED_STORAGE_CAP,
};
const BANDWIDTH_USAGE_CACHE = new Map();
const TEST_MODE_BYPASS_HASH = 'ARK_TEST_BYPASS'; // REMOVE BEFORE GOING LIVE
const PAYMENT_WALLETS = {
  BTC: 'bc1qy0rc5kq9wacgzau7f92wu8ch5ye0aet7c6urhc',
  LTC: 'ltc1q9casldmsejj9pxsqd5c0222htkq6xqvhvmqnhr',
  XMR: '4254cXFs8vLXCEVm1T7TDAdovjqMiNZX8aym8DiMM2EiUVbDnhRQt6uauFyTeP2pkqXtcodDWPoPg1nrQNsz8xuqP3q3rrQ',
};
const DEFAULT_TIER_CONFIG = {
  starter: { priceEur: 0, storageLimit: 50 * GB },
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
      if (pathname === '/admin/users/disable' && request.method === 'POST') return withCors(await adminDisableUser(request, env));
      if (pathname === '/admin/users/restore' && request.method === 'POST') return withCors(await adminRestoreUser(request, env));
      if (pathname === '/admin/users/details' && request.method === 'GET') return withCors(await adminUserDetails(request, env));
      if (pathname === '/admin/audit' && request.method === 'GET') return withCors(await listAdminAuditLogs(request, env));
      if (pathname === '/admin/system/health' && request.method === 'GET') return withCors(await adminSystemHealth(request, env));

      if (pathname === '/auth/register' && request.method === 'POST') return withCors(await register(request, env));
      if (pathname === '/auth/login' && request.method === 'POST') return withCors(await login(request, env));
      if (pathname === '/auth/me' && request.method === 'GET') return withCors(await getMe(request, env));
      if (pathname === '/auth/sessions' && request.method === 'GET') return withCors(await listSessions(request, env));
      if (pathname === '/auth/sessions/revoke' && request.method === 'POST') return withCors(await revokeSession(request, env));
      if (pathname === '/auth/sessions/revoke-all' && request.method === 'POST') return withCors(await revokeAllSessions(request, env));
      if (pathname === '/verify-payment' && request.method === 'POST') return withCors(await verifyPayment(request, env));

      if (pathname === '/files/upload' && request.method === 'POST') return withCors(await uploadFile(request, env));
      if (pathname === '/files' && request.method === 'GET') return withCors(await listFiles(request, env));
      if (pathname === '/files/download' && request.method === 'GET') return withCors(await downloadFile(request, env));
      if (pathname === '/files/view' && request.method === 'GET') return withCors(await viewFile(request, env));
      if (pathname === '/files/delete' && request.method === 'POST') return withCors(await deleteFile(request, env));

      return withCors(jsonError('Not found', 404, 'not_found'));
    } catch (err) {
      return withCors(jsonError('Server error: ' + err.message, 500, 'server_error'));
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

// NOTE: The admin page HTML is built as a plain string (no template literal) so there
// is zero risk of a stray backtick breaking the outer Worker source.
function buildAdminHtml() {
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>ARK | Admin Console</title>',
    '  <style>',
    '    :root {',
    '      color-scheme: dark;',
    '      --bg: #0a0a0a;',
    '      --surface: #111111;',
    '      --surface-accent: #1a1a1a;',
    '      --border: rgba(255,255,255,.07);',
    '      --border-strong: rgba(255,255,255,.12);',
    '      --text: #f0f0f0;',
    '      --muted: #666;',
    '      --muted-light: #888;',
    '      --accent: #ff6b00;',
    '      --accent-soft: rgba(255,107,0,.12);',
    '      --error: #ff4444;',
    '      --success: #00cc66;',
    "      --font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
    "      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;",
    '    }',
    '    * { box-sizing: border-box; }',
    '    body {',
    '      margin: 0;',
    '      background: var(--bg);',
    '      color: var(--text);',
    '      font-family: var(--font-body);',
    '      min-height: 100vh;',
    '      position: relative;',
    '    }',
    "    body::before {",
    "      content: '';",
    '      position: fixed;',
    '      inset: 0;',
    '      background-image: radial-gradient(rgba(255,255,255,.025) 1px, transparent 1px);',
    '      background-size: 40px 40px;',
    '      pointer-events: none;',
    '      z-index: 0;',
    '    }',
    '    .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 18px 24px; position: relative; z-index: 1; }',
    '    .top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; }',
    '    .brand { font-weight: 900; font-size: 1.4rem; letter-spacing: 5px; text-transform: uppercase; }',
    '    .brand span { color: var(--accent); }',
    '    .brand-sub { font-family: var(--font-mono); font-size: .58rem; letter-spacing: 3px; text-transform: uppercase; color: var(--muted-light); margin-top: 3px; }',
    '    .status-chip { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 2px; padding: 8px 14px; font-family: var(--font-mono); font-size: .68rem; letter-spacing: 1px; text-transform: uppercase; color: var(--muted-light); }',
    '    .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }',
    '    .card { background: var(--surface); border: 1px solid var(--border); border-top: 3px solid var(--accent); border-radius: 2px; padding: 18px; }',
    '    .card-title { margin: 0 0 12px; font-family: var(--font-mono); font-size: .7rem; letter-spacing: 3px; color: var(--muted-light); text-transform: uppercase; }',
    '    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }',
    '    input, button, select { border-radius: 2px; border: 1px solid var(--border-strong); background: var(--surface-accent); color: var(--text); padding: 10px 12px; font-family: var(--font-body); font-size: .84rem; }',
    '    input:focus, button:focus, select:focus { outline: 1px solid var(--accent); outline-offset: 1px; }',
    '    button { cursor: pointer; background: var(--accent); border-color: var(--accent); color: #111; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; font-size: .75rem; }',
    '    button:hover { filter: brightness(1.03); }',
    '    button:disabled { opacity: .65; cursor: not-allowed; }',
    '    button.btn-danger { background: var(--error); border-color: var(--error); color: #fff; }',
    '    button.btn-secondary { background: var(--surface-accent); border-color: var(--border-strong); color: var(--text); }',
    '    table { width: 100%; border-collapse: collapse; min-width: 760px; }',
    '    th, td { text-align: left; padding: 11px 8px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: middle; }',
    '    th { color: var(--muted-light); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-family: var(--font-mono); }',
    '    .mono { font-family: var(--font-mono); }',
    '    .muted { color: var(--muted-light); font-size: 13px; }',
    '    .error { color: var(--error); }',
    '    .ok { color: var(--success); }',
    '    .table-wrap { overflow: auto; border: 1px solid var(--border); background: rgba(0,0,0,.12); }',
    '    .hint { margin: 10px 0 0; line-height: 1.55; }',
    '    @media (max-width: 840px) { .top { align-items: flex-start; flex-direction: column; } .status-chip { width: 100%; text-align: center; } table { min-width: 620px; } }',
    '    @media (max-width: 640px) { .wrap { padding: 20px 12px 18px; } .card { padding: 14px; } table { min-width: 540px; } td .row { gap: 8px; } td .row input { min-width: 190px; flex: 1; } }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="wrap">',
    '    <div class="top">',
    '      <div>',
    '        <div class="brand"><span>A</span>RK</div>',
    '        <div class="brand-sub">Admin Control Node</div>',
    '      </div>',
    '      <div class="status-chip">Restricted Access</div>',
    '    </div>',
    '    <div class="grid">',
    '    <div class="card">',
    '      <h1 class="card-title">Admin Authentication</h1>',
    '      <div class="row">',
    '        <input id="password" type="password" placeholder="Admin password" style="min-width:260px" />',
    '        <input id="otp" type="text" placeholder="OTP (optional)" style="min-width:170px" />',
    '        <button id="load" type="button">Load Users</button>',
    '        <button id="health-btn" type="button" class="btn-secondary">System Health</button>',
    '        <button id="audit-btn" type="button" class="btn-secondary">Audit Trail</button>',
    '      </div>',
    '      <p class="muted hint">This endpoint is intentionally hidden. Access requires the worker env var <span class="mono">ADMIN_PASSWORD</span>.</p>',
    '      <p class="muted hint">If <span class="mono">ADMIN_TOTP_SECRET</span> is set, OTP is required too.</p>',
    '      <p class="muted hint">Use only over HTTPS.</p>',
    '      <p id="status" class="muted hint" style="min-height:18px"></p>',
    '    </div>',
    '    <div class="card">',
    '      <div class="row" style="justify-content:space-between">',
    '        <h2 class="card-title" style="margin:0">User Capacity Controls</h2>',
    '        <span id="count" class="muted">0 users</span>',
    '      </div>',
    '      <div class="row" style="margin-top:10px">',
    '        <input id="user-search" type="text" placeholder="Search user email..." style="min-width:220px" />',
    '        <select id="user-filter">',
    '          <option value="all">All users</option>',
    '          <option value="disabled">Disabled only</option>',
    '          <option value="active">Active only</option>',
    '          <option value="near_cap">Near capacity (&gt;=80%)</option>',
    '          <option value="unlimited">Unlimited cap</option>',
    '        </select>',
    '        <select id="user-sort">',
    '          <option value="created_desc">Newest</option>',
    '          <option value="created_asc">Oldest</option>',
    '          <option value="usage_desc">Highest usage</option>',
    '          <option value="usage_asc">Lowest usage</option>',
    '          <option value="email_asc">Email A-Z</option>',
    '          <option value="email_desc">Email Z-A</option>',
    '        </select>',
    '      </div>',
    '      <div class="table-wrap" style="margin-top:10px">',
    '        <table>',
    '          <thead><tr>',
    '            <th>Email</th><th>Used</th><th>Limit</th><th>Status</th>',
    '            <th>Set new limit (GB or unlimited)</th><th>Actions</th>',
    '          </tr></thead>',
    '          <tbody id="users-body">',
    '            <tr><td colspan="6" class="muted">Enter password and load users.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </div>',
    '    <div class="card">',
    '      <h2 class="card-title">User Detail Drawer</h2>',
    '      <div id="user-detail" class="muted">Select "Details" on any user to inspect metadata.</div>',
    '    </div>',
    '    <div class="card">',
    '      <h2 class="card-title">System Health</h2>',
    '      <pre id="health-output" class="muted" style="white-space:pre-wrap;line-height:1.45;max-height:220px;overflow:auto">// No health checks run yet.</pre>',
    '    </div>',
    '    <div class="card">',
    '      <h2 class="card-title">Admin Audit Trail</h2>',
    '      <pre id="audit-output" class="muted" style="white-space:pre-wrap;line-height:1.45;max-height:260px;overflow:auto">// No audit logs loaded yet.</pre>',
    '    </div>',
    '    </div>',
    '  </div>',
    '<script>',
    '(function() {',
    '  var adminPassword = "";',
    '  var adminOtp = "";',
    '  var users = [];',
    '  var activeFilters = { query: "", filter: "all", sort: "created_desc" };',
    '  var GB = 1073741824;',
    '  var LOAD_USERS_TIMEOUT_MS = 15000;',
    '  var UNLIMITED_ALIASES = ["unlimited", "\u221e", "inf", "infinite"];',
    '  function isUnlimited(b) { return Number(b) < 0; }',
    '  function fmtStorage(bytes) {',
    '    if (isUnlimited(bytes)) return "Unlimited";',
    '    var n = Number.isFinite(Number(bytes)) ? Math.max(0, Number(bytes)) : 0;',
    '    if (n >= 1024 * GB) return (n / (1024 * GB)).toFixed(2) + " TB";',
    '    if (n >= GB) return (n / GB).toFixed(2) + " GB";',
    '    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";',
    '    if (n >= 1024) return (n / 1024).toFixed(2) + " KB";',
    '    return n.toFixed(0) + " B";',
    '  }',
    '  function esc(v) {',
    '    return String(v || "").replace(/[&<>"\']/g, function(ch) {',
    '      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" }[ch];',
    '    });',
    '  }',
    '  function setStatus(msg, type) {',
    '    var el = document.getElementById("status");',
    '    el.textContent = msg || "";',
    '    el.className = type || "muted";',
    '  }',
    '  function getFiltered() {',
    '    var q = String(activeFilters.query || "").trim().toLowerCase();',
    '    var list = users.filter(function(u) {',
    '      var email = String(u.email || "").toLowerCase();',
    '      var cap = Number(u.storage_cap || 0);',
    '      var used = Number(u.storage_used || 0);',
    '      var unl = isUnlimited(cap);',
    '      var pct = unl ? 0 : (cap > 0 ? (used / cap) * 100 : 0);',
    '      var mq = !q || email.indexOf(q) !== -1;',
    '      var mf = true;',
    '      if (activeFilters.filter === "disabled") mf = Boolean(u.disabled);',
    '      if (activeFilters.filter === "active") mf = !u.disabled;',
    '      if (activeFilters.filter === "near_cap") mf = !unl && pct >= 80;',
    '      if (activeFilters.filter === "unlimited") mf = unl;',
    '      return mq && mf;',
    '    });',
    '    list.sort(function(a, b) {',
    '      if (activeFilters.sort === "email_asc") return String(a.email || "").localeCompare(String(b.email || ""));',
    '      if (activeFilters.sort === "email_desc") return String(b.email || "").localeCompare(String(a.email || ""));',
    '      if (activeFilters.sort === "usage_asc") return Number(a.storage_used || 0) - Number(b.storage_used || 0);',
    '      if (activeFilters.sort === "usage_desc") return Number(b.storage_used || 0) - Number(a.storage_used || 0);',
    '      if (activeFilters.sort === "created_asc") return new Date(a.created_at || 0) - new Date(b.created_at || 0);',
    '      return new Date(b.created_at || 0) - new Date(a.created_at || 0);',
    '    });',
    '    return list;',
    '  }',
    '  function adminHeaders() {',
    '    return { "Authorization": "Bearer " + adminPassword, "X-Admin-OTP": adminOtp };',
    '  }',
    '  function jsonHeaders() {',
    '    return { "Content-Type": "application/json", "Authorization": "Bearer " + adminPassword, "X-Admin-OTP": adminOtp };',
    '  }',
    '  async function openUserDetails(userId) {',
    '    try {',
    '      var res = await fetch("/admin/users/details?userId=" + encodeURIComponent(userId), { headers: adminHeaders() });',
    '      var data = await res.json();',
    '      if (!res.ok || !data.ok) throw new Error(data.error || "Failed loading details");',
    '      var d = data.details || {};',
    '      var largest = Array.isArray(d.largestFiles) ? d.largestFiles : [];',
    '      var recent = Array.isArray(d.recentUploads) ? d.recentUploads : [];',
    '      document.getElementById("user-detail").textContent =',
    '        "User: " + ((data.user && (data.user.email || data.user.id)) || "-") + "\\n" +',
    '        "Disabled: " + (data.user && data.user.disabled ? "Yes" : "No") + "\\n" +',
    '        "File count: " + Number(d.fileCount || 0) + "\\n" +',
    '        "Bandwidth today: " + fmtStorage((d.bandwidth && d.bandwidth.usedBytes) || 0) + "\\n" +',
    '        "Last activity: " + (d.lastActivityAt ? new Date(d.lastActivityAt).toLocaleString() : "Unknown") + "\\n" +',
    '        "Recent uploads: " + (recent.slice(0,5).map(function(f){ return String(f.name || "unnamed"); }).join(", ") || "None") + "\\n" +',
    '        "Largest files: " + (largest.slice(0,5).map(function(f){ return String(f.name || "unnamed") + " (" + fmtStorage(f.size || 0) + ")"; }).join(", ") || "None");',
    '    } catch(err) {',
    '      document.getElementById("user-detail").textContent = "Failed to load details: " + (err.message || "Unknown error");',
    '    }',
    '  }',
    '  async function loadSystemHealth() {',
    '    try {',
    '      var res = await fetch("/admin/system/health", { headers: adminHeaders() });',
    '      var data = await res.json();',
    '      if (!res.ok || !data.ok) throw new Error(data.error || "Health check failed");',
    '      document.getElementById("health-output").textContent = JSON.stringify(data.health, null, 2);',
    '      setStatus("Health loaded.", "ok");',
    '    } catch(err) {',
    '      document.getElementById("health-output").textContent = "Health check failed: " + (err.message || "Unknown error");',
    '      setStatus(err.message || "Health check failed", "error");',
    '    }',
    '  }',
    '  async function loadAuditLogs() {',
    '    try {',
    '      var res = await fetch("/admin/audit", { headers: adminHeaders() });',
    '      var data = await res.json();',
    '      if (!res.ok || !data.ok) throw new Error(data.error || "Audit load failed");',
    '      document.getElementById("audit-output").textContent = JSON.stringify((data.logs || []).slice(0, 80), null, 2);',
    '      setStatus("Audit logs loaded.", "ok");',
    '    } catch(err) {',
    '      document.getElementById("audit-output").textContent = "Audit load failed: " + (err.message || "Unknown error");',
    '      setStatus(err.message || "Audit load failed", "error");',
    '    }',
    '  }',
    '  function renderUsers() {',
    '    var body = document.getElementById("users-body");',
    '    var list = getFiltered();',
    '    document.getElementById("count").textContent = String(list.length) + " user" + (list.length === 1 ? "" : "s");',
    '    if (!list.length) { body.innerHTML = \'<tr><td colspan="6" class="muted">No users found.</td></tr>\'; return; }',
    '    body.innerHTML = list.map(function(u) {',
    '      var id = esc(u.id);',
    '      var unl = isUnlimited(u.storage_cap);',
    '      var limitGb = unl ? "unlimited" : Number((Number(u.storage_cap || 0) / GB).toFixed(2));',
    '      var pct = unl ? 0 : (Number(u.storage_cap || 0) > 0 ? Math.round((Number(u.storage_used || 0) / Number(u.storage_cap || 0)) * 100) : 0);',
    '      var st = u.disabled ? ("Disabled" + (u.disabled_reason ? " (" + esc(u.disabled_reason) + ")" : "")) : (unl ? "Unlimited" : (pct >= 90 ? "Critical" : (pct >= 80 ? "Warning" : "Active")));',
    '      return \'<tr>\' +',
    '        \'<td>\' + esc(u.email || "-") + \'</td>\' +',
    '        \'<td class="mono">\' + fmtStorage(u.storage_used) + \'</td>\' +',
    '        \'<td class="mono">\' + fmtStorage(u.storage_cap) + \'</td>\' +',
    '        \'<td class="mono">\' + st + \'</td>\' +',
    '        \'<td><div class="row"><input type="text" placeholder="1024 or unlimited" value="\' + esc(limitGb) + \'" data-cap="\' + id + \'" /><button type="button" data-save="\' + id + \'">Save</button></div></td>\' +',
    '        \'<td><div class="row">\' +',
    '        \'<button type="button" class="btn-secondary" data-details="\' + id + \'">Details</button>\' +',
    '        (u.disabled',
    '          ? \'<button type="button" class="btn-secondary" data-restore="\' + id + \'" data-email="\' + esc(u.email || "") + \'">Restore</button>\'',
    '          : \'<button type="button" class="btn-secondary" data-disable="\' + id + \'" data-email="\' + esc(u.email || "") + \'">Disable</button>\') +',
    '        \'<button type="button" class="btn-secondary" data-purge="\' + id + \'" data-email="\' + esc(u.email || "") + \'">Purge Files</button>\' +',
    '        \'<button type="button" class="btn-danger" data-delete="\' + id + \'" data-email="\' + esc(u.email || "") + \'">Delete Account</button>\' +',
    '        \'</div></td></tr>\';',
    '    }).join("");',
    '    body.querySelectorAll("button[data-save]").forEach(function(btn) {',
    '      btn.addEventListener("click", async function() {',
    '        var userId = btn.getAttribute("data-save");',
    '        var input = body.querySelector("input[data-cap=\'" + CSS.escape(userId) + "\']");',
    '        var raw = String((input && input.value) || "").trim();',
    '        var lower = raw.toLowerCase();',
    '        var payload;',
    '        if (UNLIMITED_ALIASES.indexOf(lower) !== -1) { payload = { userId: userId, storageCapUnlimited: true }; }',
    '        else {',
    '          var capGb = Number(raw);',
    '          if (!Number.isFinite(capGb) || capGb < 0) { setStatus("Storage limit must be a non-negative number or unlimited.", "error"); return; }',
    '          payload = { userId: userId, storageCapGb: capGb };',
    '        }',
    '        btn.disabled = true;',
    '        try {',
    '          var res = await fetch("/admin/users/storage-limit", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) });',
    '          var data = await res.json();',
    '          if (!res.ok || !data.ok) throw new Error(data.error || "Update failed");',
    '          setStatus("Storage limit updated.", "ok");',
    '          await loadUsers();',
    '        } catch(err) { setStatus(err.message || "Update failed", "error"); }',
    '        finally { btn.disabled = false; }',
    '      });',
    '    });',
    '    body.querySelectorAll("button[data-purge]").forEach(function(btn) {',
    '      btn.addEventListener("click", async function() {',
    '        var userId = btn.getAttribute("data-purge");',
    '        var email = btn.getAttribute("data-email") || userId;',
    '        var typed = prompt("Type the exact user email or id to purge files for:\\n" + email);',
    '        if (!typed) return;',
    '        btn.disabled = true;',
    '        try {',
    '          var res = await fetch("/admin/users/purge-files", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ userId: userId, confirmation: typed.trim() }) });',
    '          var data = await res.json();',
    '          if (!res.ok || !data.ok) throw new Error(data.error || "Purge failed");',
    '          setStatus("Files purged for " + email + ".", "ok");',
    '          await loadUsers();',
    '        } catch(err) { setStatus(err.message || "Purge failed", "error"); }',
    '        finally { btn.disabled = false; }',
    '      });',
    '    });',
    '    body.querySelectorAll("button[data-delete]").forEach(function(btn) {',
    '      btn.addEventListener("click", async function() {',
    '        var userId = btn.getAttribute("data-delete");',
    '        var email = btn.getAttribute("data-email") || userId;',
    '        var typed = prompt("Type the exact user email or id to DELETE account:\\n" + email);',
    '        if (!typed) return;',
    '        btn.disabled = true;',
    '        try {',
    '          var res = await fetch("/admin/users/delete", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ userId: userId, confirmation: typed.trim() }) });',
    '          var data = await res.json();',
    '          if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");',
    '          setStatus("Account deleted for " + email + ".", "ok");',
    '          await loadUsers();',
    '        } catch(err) { setStatus(err.message || "Delete failed", "error"); }',
    '        finally { btn.disabled = false; }',
    '      });',
    '    });',
    '    body.querySelectorAll("button[data-disable]").forEach(function(btn) {',
    '      btn.addEventListener("click", async function() {',
    '        var userId = btn.getAttribute("data-disable");',
    '        var email = btn.getAttribute("data-email") || userId;',
    '        var reason = prompt("Disable account for " + email + ". Optional reason:", "Disabled by admin");',
    '        if (reason === null) return;',
    '        btn.disabled = true;',
    '        try {',
    '          var res = await fetch("/admin/users/disable", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ userId: userId, reason: String(reason || "").trim() }) });',
    '          var data = await res.json();',
    '          if (!res.ok || !data.ok) throw new Error(data.error || "Disable failed");',
    '          setStatus("Account disabled for " + email + ".", "ok");',
    '          await loadUsers();',
    '        } catch(err) { setStatus(err.message || "Disable failed", "error"); }',
    '        finally { btn.disabled = false; }',
    '      });',
    '    });',
    '    body.querySelectorAll("button[data-restore]").forEach(function(btn) {',
    '      btn.addEventListener("click", async function() {',
    '        var userId = btn.getAttribute("data-restore");',
    '        var email = btn.getAttribute("data-email") || userId;',
    '        btn.disabled = true;',
    '        try {',
    '          var res = await fetch("/admin/users/restore", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ userId: userId }) });',
    '          var data = await res.json();',
    '          if (!res.ok || !data.ok) throw new Error(data.error || "Restore failed");',
    '          setStatus("Account restored for " + email + ".", "ok");',
    '          await loadUsers();',
    '        } catch(err) { setStatus(err.message || "Restore failed", "error"); }',
    '        finally { btn.disabled = false; }',
    '      });',
    '    });',
    '    body.querySelectorAll("button[data-details]").forEach(function(btn) {',
    '      btn.addEventListener("click", async function() {',
    '        await openUserDetails(btn.getAttribute("data-details"));',
    '      });',
    '    });',
    '  }',
    '  async function loadUsers() {',
    '    var controller = new AbortController();',
    '    var timeout = setTimeout(function() { controller.abort(); }, LOAD_USERS_TIMEOUT_MS);',
    '    try {',
    '      var res = await fetch("/admin/users", { headers: adminHeaders(), signal: controller.signal });',
    '      var data = await res.json();',
    '      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load users");',
    '      users = Array.isArray(data.users) ? data.users : [];',
    '      renderUsers();',
    '      setStatus("Loaded " + users.length + " users.", "ok");',
    '    } catch(err) {',
    '      users = [];',
    '      renderUsers();',
    '      var msg = "Failed to load users";',
    '      if (err && err.name === "AbortError") msg = "Request timed out while loading users.";',
    '      else if (err && err.message) msg = err.message;',
    '      setStatus(msg, "error");',
    '    } finally {',
    '      clearTimeout(timeout);',
    '    }',
    '  }',
    '  async function handleLoad() {',
    '    adminPassword = document.getElementById("password").value.trim();',
    '    adminOtp = document.getElementById("otp").value.trim();',
    '    if (!adminPassword) { setStatus("Enter admin password first.", "error"); return; }',
    '    setStatus("Loading users...", "muted");',
    '    var btn = document.getElementById("load");',
    '    btn.disabled = true;',
    '    try { await loadUsers(); } finally { btn.disabled = false; }',
    '  }',
    '  document.getElementById("load").addEventListener("click", handleLoad);',
    '  document.getElementById("password").addEventListener("keydown", function(e) { if (e.key === "Enter") { e.preventDefault(); handleLoad(); } });',
    '  document.getElementById("health-btn").addEventListener("click", async function() {',
    '    adminPassword = document.getElementById("password").value.trim();',
    '    adminOtp = document.getElementById("otp").value.trim();',
    '    if (!adminPassword) { setStatus("Enter admin password first.", "error"); return; }',
    '    await loadSystemHealth();',
    '  });',
    '  document.getElementById("audit-btn").addEventListener("click", async function() {',
    '    adminPassword = document.getElementById("password").value.trim();',
    '    adminOtp = document.getElementById("otp").value.trim();',
    '    if (!adminPassword) { setStatus("Enter admin password first.", "error"); return; }',
    '    await loadAuditLogs();',
    '  });',
    '  document.getElementById("user-search").addEventListener("input", function() { activeFilters.query = this.value; renderUsers(); });',
    '  document.getElementById("user-filter").addEventListener("change", function() { activeFilters.filter = this.value; renderUsers(); });',
    '  document.getElementById("user-sort").addEventListener("change", function() { activeFilters.sort = this.value; renderUsers(); });',
    '})();',
    '</script>',
    '</body>',
    '</html>',
  ];
  return html.join('\n');
}

function serveAdminPage() {
  return new Response(buildAdminHtml(), {
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
  return jsonOk({
    users: users.map((u) => ({
      ...u,
      disabled: isUserSoftDisabled(u.id),
      disabled_reason: isUserSoftDisabled(u.id) ? SOFT_DISABLED_USERS.get(String(u.id)).reason : '',
    })),
  });
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
  logAdminAudit(request, 'update_storage_limit', { userId, storageCapBytes });
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
  const confirmation = String(body.confirmation || '').trim();
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');

  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  const targetEmail = String(users[0].email || '');
  if (confirmation !== targetEmail && confirmation !== userId) {
    return jsonError('Type the exact user email or id to confirm purge', 400, 'missing_typed_confirmation');
  }

  const purged = await deleteUserFiles(userId, env);
  await sbPatch(env, `users?id=eq.${enc(userId)}`, { storage_used: 0 });
  logAdminAudit(request, 'purge_user_files', { userId, email: targetEmail, purged });

  return jsonOk({ purged });
}

async function adminDeleteUser(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const confirmation = String(body.confirmation || '').trim();
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');

  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  const targetEmail = String(users[0].email || '');
  if (confirmation !== targetEmail && confirmation !== userId) {
    return jsonError('Type the exact user email or id to confirm delete', 400, 'missing_typed_confirmation');
  }

  const filesRemoved = await deleteUserFiles(userId, env);
  await sbDelete(env, `users?id=eq.${enc(userId)}`);
  clearSessionsForUser(userId);
  SOFT_DISABLED_USERS.delete(String(userId));
  logAdminAudit(request, 'delete_user', { userId, email: targetEmail, filesRemoved });

  return jsonOk({ deleted: true, filesRemoved });
}

async function adminDisableUser(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const reason = String(body.reason || '').trim().slice(0, 200) || 'Disabled by admin';
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');
  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  SOFT_DISABLED_USERS.set(String(userId), { reason, disabledAt: new Date().toISOString() });
  clearSessionsForUser(userId);
  logAdminAudit(request, 'disable_user', { userId, email: users[0].email, reason });
  return jsonOk({ disabled: true, userId, reason });
}

async function adminRestoreUser(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');
  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  SOFT_DISABLED_USERS.delete(String(userId));
  logAdminAudit(request, 'restore_user', { userId, email: users[0].email });
  return jsonOk({ restored: true, userId });
}

async function adminUserDetails(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;
  const { searchParams } = new URL(request.url);
  const userId = String(searchParams.get('userId') || '').trim();
  if (!userId) return jsonError('userId is required', 400, 'missing_user_id');

  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,email,storage_used,storage_cap,created_at`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  const files = await sbGet(env, `files?user_id=eq.${enc(userId)}&select=id,name,size,uploaded_at&order=uploaded_at.desc`);
  const dayKey = currentUtcDayKey();
  const usageKey = `${String(userId)}:${dayKey}`;
  const usedBandwidthBytes = Number(BANDWIDTH_USAGE_CACHE.get(usageKey) || 0);
  const sessions = SESSION_STORE.get(String(userId)) || [];
  return jsonOk({
    user: {
      ...users[0],
      disabled: isUserSoftDisabled(userId),
      disabled_reason: isUserSoftDisabled(userId) ? SOFT_DISABLED_USERS.get(String(userId)).reason : '',
    },
    details: {
      fileCount: files.length,
      largestFiles: [...files].sort((a, b) => Number(b.size || 0) - Number(a.size || 0)).slice(0, 5),
      recentUploads: files.slice(0, 8),
      bandwidth: { dayKey, usedBytes: usedBandwidthBytes },
      lastActivityAt: sessions.reduce((acc, s) => {
        const t = Date.parse(s.lastSeenAt || 0);
        return t > acc ? t : acc;
      }, 0) || null,
    },
  });
}

async function listAdminAuditLogs(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;
  return jsonOk({ logs: [...ADMIN_AUDIT_LOGS].reverse() });
}

async function adminSystemHealth(request, env) {
  const adminError = await requireAdmin(request, env);
  if (adminError) return adminError;
  const health = {
    timestamp: new Date().toISOString(),
    checks: {
      supabase: { ok: false, detail: '' },
      telegram: { ok: false, detail: '' },
      bridge: { ok: false, detail: '' },
    },
  };
  try {
    await sbGet(env, 'users?select=id&limit=1');
    health.checks.supabase = { ok: true, detail: 'reachable' };
  } catch (err) {
    health.checks.supabase = { ok: false, detail: String(err?.message || 'failed') };
  }
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/getMe`);
    const tgData = await tgRes.json().catch(() => ({}));
    health.checks.telegram = { ok: tgRes.ok && tgData.ok === true, detail: tgData.description || (tgRes.ok ? 'reachable' : `HTTP ${tgRes.status}`) };
  } catch (err) {
    health.checks.telegram = { ok: false, detail: String(err?.message || 'failed') };
  }
  try {
    const bridgeRes = await fetch(`${env.BRIDGE_URL}/health`, { headers: { 'x-bridge-secret': env.BRIDGE_SECRET } });
    health.checks.bridge = { ok: bridgeRes.ok, detail: bridgeRes.ok ? 'reachable' : `HTTP ${bridgeRes.status}` };
  } catch (err) {
    health.checks.bridge = { ok: false, detail: String(err?.message || 'failed') };
  }
  return jsonOk({
    health,
    lockout: {
      active: [...ADMIN_LOCKOUTS.entries()].map(([key, until]) => ({ key, until })),
      failedAttemptsTracked: ADMIN_AUTH_ATTEMPTS.size,
    },
  });
}

function parseStorageCapBytes(body) {
  if (body && body.storageCapUnlimited === true) return UNLIMITED_STORAGE_CAP;
  if (body && UNLIMITED_STORAGE_ALIASES.includes(String(body.storageCap || '').trim().toLowerCase())) return UNLIMITED_STORAGE_CAP;
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
  if (!isHttps && !isLocalDev) return jsonError('Admin access requires HTTPS', 400, 'https_required');

  const configured = String(env.ADMIN_PASSWORD || '');
  if (!configured) return jsonError('ADMIN_PASSWORD is not configured', 500, 'admin_not_configured');
  const adminKey = getAdminRateKey(request);
  const lockoutUntil = Number(ADMIN_LOCKOUTS.get(adminKey) || 0);
  if (lockoutUntil > Date.now()) return jsonError('Admin access temporarily locked due to repeated failed attempts', 429, 'admin_temporarily_locked');

  const authHeader = String(request.headers.get('Authorization') || '');
  const suppliedFromBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const supplied = String(suppliedFromBearer || request.headers.get('X-Admin-Password') || '');
  const passwordOk = safeEqual(supplied, configured);
  const otpRequired = String(env.ADMIN_TOTP_SECRET || '').trim().length > 0;
  const suppliedOtp = String(request.headers.get('X-Admin-OTP') || request.headers.get('X-Admin-TOTP') || '');
  const otpOk = !otpRequired || await verifyAdminTotp(String(env.ADMIN_TOTP_SECRET || ''), suppliedOtp);
  if (!(passwordOk && otpOk)) {
    registerAdminAuthFailure(adminKey);
    return jsonError('Unauthorized', 401, 'unauthorized_admin');
  }
  ADMIN_AUTH_ATTEMPTS.delete(adminKey);
  ADMIN_LOCKOUTS.delete(adminKey);
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
  const created = await sbPost(env, 'users', { email, password_hash: passwordHash, storage_used: 0, storage_cap: BASE_STORAGE });
  if (!created?.length) return jsonError('Account creation failed', 500, 'account_creation_failed');
  const user = created[0];

  const session = createUserSession(user.id, request);
  const token = await makeJWT({ userId: user.id, email: user.email, sid: session.id }, env.JWT_SECRET);
  return jsonOk({ token, email: user.email, session: session.publicView });
}

async function login(request, env) {
  const { email = '', password = '' } = await request.json().catch(() => ({}));
  const normalizedEmail = String(email).trim().toLowerCase();
  const users = await sbGet(env, `users?email=eq.${enc(normalizedEmail)}&select=*`);
  if (!users.length || !(await verifyPassword(password, users[0].password_hash))) return jsonError('Invalid credentials', 401, 'invalid_credentials');
  const user = users[0];
  if (isUserSoftDisabled(user.id)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  const session = createUserSession(user.id, request);
  const token = await makeJWT({ userId: user.id, email: user.email, sid: session.id }, env.JWT_SECRET);
  return jsonOk({ token, email: user.email, storage_used: user.storage_used, storage_cap: user.storage_cap, session: session.publicView });
}

async function getMe(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=*`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  touchSession(auth.userId, auth.sid, request);
  return jsonOk({ ...users[0], disabled: isUserSoftDisabled(auth.userId) });
}

async function listSessions(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  touchSession(auth.userId, auth.sid, request);
  const sessions = (SESSION_STORE.get(String(auth.userId)) || []).map((s) => ({
    ...s.publicView,
    current: String(s.id) === String(auth.sid),
  }));
  return jsonOk({ sessions });
}

async function revokeSession(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  const body = await request.json().catch(() => ({}));
  const sessionId = String(body.sessionId || '').trim();
  if (!sessionId) return jsonError('sessionId is required', 400, 'missing_session_id');
  revokeUserSession(auth.userId, sessionId);
  return jsonOk({ revoked: true, sessionId });
}

async function revokeAllSessions(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  clearSessionsForUser(auth.userId);
  return jsonOk({ revokedAll: true });
}

function normalizePaymentCurrency(currency) {
  const value = String(currency || '').trim().toUpperCase();
  return ['BTC', 'LTC', 'XMR'].includes(value) ? value : '';
}

function normalizeTransactionHash(transactionHash) {
  return String(transactionHash || '').trim().toLowerCase();
}

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

async function fetchReceivedAmount(currency, transactionHash, walletAddress) {
  if (currency === 'BTC') {
    const txData = await fetchJsonFromApi(`https://mempool.space/api/tx/${transactionHash}`, 'Unable to fetch BTC transaction');
    return getBtcReceivedAmount(txData, walletAddress);
  }
  if (currency === 'LTC') {
    const txData = await fetchJsonFromApi(`https://blockchair.com/litecoin/dashboards/transaction/${transactionHash}`, 'Unable to fetch LTC transaction');
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
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const tierName = String(body.tierName || '').trim();
  const currency = normalizePaymentCurrency(body.currency);
  const transactionHash = normalizeTransactionHash(body.transactionHash);

  if (!userId || !tierName || !currency || !transactionHash) return jsonError('userId, tierName, currency, and transactionHash are required', 400, 'missing_payment_fields');

  const isBypass = isTestModeBypassHash(transactionHash, env); // REMOVE BEFORE GOING LIVE
  if (!isBypass && !isValidTransactionHash(transactionHash)) return jsonError('Invalid transaction hash — must be a 64-character hex string', 400, 'invalid_transaction_hash');
  if (auth.userId !== userId) return jsonError('Forbidden', 403, 'forbidden');

  const duplicateError = await ensurePaymentNotProcessed(env, transactionHash);
  if (duplicateError) return duplicateError;

  const tier = resolveTierConfig(env, tierName);
  if (!tier) return jsonError('Unknown tierName or invalid tier config', 400, 'invalid_tier');
  const claimed = await claimPayment(env, { user_id: userId, tier_name: tier.name, currency, transaction_hash: transactionHash, status: 'processing' });
  if (!claimed) return jsonError('Transaction hash already processed', 409, 'transaction_already_processed');

  // ===== TEST MODE BYPASS (REMOVE BEFORE GOING LIVE) =====
  if (isBypass) {
    const updatedProfile = await sbPatch(env, `users?id=eq.${enc(userId)}`, { storage_cap: tier.storageLimit });
    if (!updatedProfile.length) {
      await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, { status: 'failed_profile_not_found' });
      return jsonError('Profile not found', 404, 'profile_not_found');
    }
    await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, { status: 'used_test_bypass_remove_before_live', status_reason: 'remove_before_live', wallet_address: 'TEST_MODE_BYPASS_REMOVE_BEFORE_LIVE' });
    return jsonOk({ verified: true, testModeBypass: true, currency, tierName: tier.name, storageLimit: tier.storageLimit, transactionHash });
  }
  // ===== END TEST MODE BYPASS =====

  if (currency === 'XMR') {
    await sbPost(env, 'manual_verifications', { user_id: userId, tier_name: tier.name, currency, transaction_hash: transactionHash, status: 'Pending', wallet_address: PAYMENT_WALLETS.XMR });
    await sbPatch(env, `payments?transaction_hash=eq.${enc(transactionHash)}`, { status: 'pending_manual', wallet_address: PAYMENT_WALLETS.XMR });
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

  return jsonOk({ verified: true, currency, tierName: tier.name, storageLimit: tier.storageLimit, transactionHash });
}

async function uploadFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  touchSession(auth.userId, auth.sid, request);

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file) return jsonError('File is required', 400, 'missing_file');
  if (file.size > FILE_LIMIT) return jsonError('File exceeds 2GB limit', 413, 'file_too_large');

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=storage_used,storage_cap`);
  const u = users[0];
  if (!u) return jsonError('User not found', 404, 'user_not_found');
  const cap = Number(u.storage_cap);
  const isUnlimited = Number.isFinite(cap) && cap < 0;
  if (!isUnlimited && (u.storage_used || 0) + file.size > (u.storage_cap || 0)) return jsonError('Storage full', 413, 'storage_full');

  const bridgeForm = new FormData();
  bridgeForm.append('file', file, file.name);

  const bridgeRes = await fetch(`${env.BRIDGE_URL}/upload`, {
    method: 'POST',
    headers: { 'x-bridge-secret': env.BRIDGE_SECRET, 'x-user-email': auth.email },
    body: bridgeForm,
  });

  if (!bridgeRes.ok) {
    const err = await bridgeRes.json().catch(() => ({}));
    return jsonError(err.detail || 'Upload bridge failed', 502, 'bridge_upload_failed');
  }

  const bridgeData = await bridgeRes.json();
  const fileId = bridgeData.file_id;
  const messageId = bridgeData.message_id;
  if (!fileId || !messageId) return jsonError('Bridge returned incomplete data', 502, 'bridge_invalid_response');

  const saved = await sbPost(env, 'files', { user_id: auth.userId, name: file.name, size: file.size, type: file.type, file_id: fileId, message_id: messageId });
  await sbPatch(env, `users?id=eq.${auth.userId}`, { storage_used: (u.storage_used || 0) + file.size });
  return jsonOk({ file: saved[0] });
}

function currentUtcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDailyBandwidthCapBytes(storageCapBytes) {
  const cap = Number(storageCapBytes);
  if (cap < 0) return DAILY_BANDWIDTH_LIMITS.studio;
  if (!Number.isFinite(cap) || cap === 0) return DAILY_BANDWIDTH_LIMITS.starter;
  if (cap >= DEFAULT_TIER_CONFIG.creator.storageLimit) return DAILY_BANDWIDTH_LIMITS.creator;
  if (cap >= DEFAULT_TIER_CONFIG.pro.storageLimit) return DAILY_BANDWIDTH_LIMITS.pro;
  return DAILY_BANDWIDTH_LIMITS.starter;
}

function cleanupBandwidthUsageCache(dayKey) {
  for (const key of BANDWIDTH_USAGE_CACHE.keys()) {
    if (!key.endsWith(`:${dayKey}`)) BANDWIDTH_USAGE_CACHE.delete(key);
  }
}

function consumeDailyBandwidth(userId, storageCapBytes, transferBytes) {
  const bytes = Math.max(0, Math.round(Number(transferBytes)));
  const capBytes = getDailyBandwidthCapBytes(storageCapBytes);
  if (capBytes < 0) return { allowed: true };
  const dayKey = currentUtcDayKey();
  cleanupBandwidthUsageCache(dayKey);
  const usageKey = `${String(userId)}:${dayKey}`;
  const used = Number(BANDWIDTH_USAGE_CACHE.get(usageKey) || 0);
  if (!bytes) return { allowed: true, limitBytes: capBytes, usedBytes: used };
  const attemptedUsedBytes = used + bytes;
  if (attemptedUsedBytes > capBytes) return { allowed: false, limitBytes: capBytes, usedBytes: used, attemptedUsedBytes, requestedBytes: bytes };
  BANDWIDTH_USAGE_CACHE.set(usageKey, attemptedUsedBytes);
  return { allowed: true, limitBytes: capBytes, usedBytes: attemptedUsedBytes };
}

async function enforceDailyBandwidthLimit(env, userId, transferBytes) {
  const users = await sbGet(env, `users?id=eq.${enc(userId)}&select=id,storage_cap`);
  if (!users.length) return jsonError('User not found', 404, 'user_not_found');
  const usage = consumeDailyBandwidth(userId, users[0].storage_cap, transferBytes);
  if (!usage.allowed) return jsonError('Daily bandwidth limit reached for your current tier', 429, 'bandwidth_limit_reached');
  return null;
}

async function listFiles(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  touchSession(auth.userId, auth.sid, request);
  const files = await sbGet(env, `files?user_id=eq.${auth.userId}&order=uploaded_at.desc&select=*`);
  return jsonOk({ files });
}

async function downloadFile(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return jsonError('Unauthorized', 401, 'unauthorized');
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  touchSession(auth.userId, auth.sid, request);

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  if (!fileId) return jsonError('fileId required', 400, 'missing_file_id');

  const files = await sbGet(env, `files?file_id=eq.${enc(fileId)}&user_id=eq.${auth.userId}&select=id,name,type,size`);
  if (files.length === 0) return jsonError('Access denied', 404, 'file_not_found');
  const file = files[0];
  const bandwidthError = await enforceDailyBandwidthLimit(env, auth.userId, file.size);
  if (bandwidthError) return bandwidthError;

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
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  touchSession(auth.userId, auth.sid, request);

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  if (!fileId) return jsonError('fileId required', 400, 'missing_file_id');

  const files = await sbGet(env, `files?file_id=eq.${enc(fileId)}&user_id=eq.${auth.userId}&select=id,name,type,size`);
  if (files.length === 0) return jsonError('Access denied', 404, 'file_not_found');
  const file = files[0];
  if (!isPreviewableMediaFile(file)) return jsonError('File type cannot be previewed', 415, 'preview_not_supported');
  const bandwidthError = await enforceDailyBandwidthLimit(env, auth.userId, file.size);
  if (bandwidthError) return bandwidthError;

  const tgRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const tgData = await tgRes.json();
  if (!tgData.ok) return jsonError(tgData.description || 'Telegram fetch failed', 502, 'telegram_get_file_failed');

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${encodeURIComponent(env.BOT_TOKEN)}/${tgData.result.file_path}`);
  if (!fileResponse.ok) return jsonError('Telegram file download failed', 502, 'telegram_download_failed');

  const upstreamContentType = fileResponse.headers.get('Content-Type') || file.type || 'application/octet-stream';
  const guessedMediaType = guessPreviewContentType(file.name);
  const contentType = isPreviewContentType(upstreamContentType) ? upstreamContentType : (guessedMediaType || upstreamContentType);
  if (!isPreviewContentType(contentType)) return jsonError('File type cannot be previewed', 415, 'preview_not_supported');

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
  if (isUserSoftDisabled(auth.userId)) return jsonError('Account is temporarily disabled by admin', 403, 'account_disabled');
  touchSession(auth.userId, auth.sid, request);

  const { fileRecordId } = await request.json().catch(() => ({}));
  if (!fileRecordId) return jsonError('fileRecordId required', 400, 'missing_file_record_id');

  const files = await sbGet(env, `files?id=eq.${fileRecordId}&user_id=eq.${auth.userId}&select=*`);
  if (!files.length) return jsonError('File not found', 404, 'file_not_found');
  const file = files[0];

  await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.BOT_TOKEN)}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.CHAT_ID, message_id: file.message_id }),
  }).catch(() => {});

  await sbDelete(env, `files?id=eq.${fileRecordId}`);

  const users = await sbGet(env, `users?id=eq.${auth.userId}&select=storage_used`);
  if (users.length) {
    await sbPatch(env, `users?id=eq.${auth.userId}`, { storage_used: Math.max(0, (users[0].storage_used || 0) - (file.size || 0)) });
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
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { method: 'DELETE', headers: sbHeaders(env) });
  if (!r.ok) throw new Error(await r.text());
}

async function makeJWT(payload, secret) {
  const encb64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const head = encb64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encb64(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS }));
  const data = `${head}.${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${encb64(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigB64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const sigPad = sigB64 + '='.repeat((4 - (sigB64.length % 4)) % 4);
    const sigBuf = Uint8Array.from(atob(sigPad), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(`${h}.${p}`));
    const payloadB64 = p.replace(/-/g, '+').replace(/_/g, '/');
    const payloadPad = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const decoded = JSON.parse(atob(payloadPad));
    return ok && decoded.exp > Date.now() / 1000 ? decoded : null;
  } catch {
    return null;
  }
}

async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
  if (!payload) return null;
  if (payload?.sid && REVOKED_SESSION_IDS.has(String(payload.sid))) return null;
  if (payload?.sid && !hasSession(payload?.userId, payload?.sid)) return null;
  return payload;
}

function randomId(size = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getRequestIp(request) {
  return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

function getRequestUserAgent(request) {
  return String(request.headers.get('user-agent') || '').slice(0, 220);
}

function createUserSession(userId, request) {
  const id = randomId(16);
  const now = new Date().toISOString();
  const session = { id, createdAt: now, lastSeenAt: now, ip: getRequestIp(request), userAgent: getRequestUserAgent(request) };
  const key = String(userId);
  const current = SESSION_STORE.get(key) || [];
  const next = [session, ...current].slice(0, 20);
  SESSION_STORE.set(key, next);
  return { ...session, publicView: { id: session.id, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, ip: session.ip, userAgent: session.userAgent } };
}

function hasSession(userId, sessionId) {
  const sessions = SESSION_STORE.get(String(userId)) || [];
  return sessions.some((s) => String(s.id) === String(sessionId));
}

function touchSession(userId, sessionId, request) {
  if (!sessionId) return;
  const key = String(userId);
  const sessions = SESSION_STORE.get(key) || [];
  let touched = false;
  const now = new Date().toISOString();
  const next = sessions.map((s) => {
    if (String(s.id) !== String(sessionId)) return s;
    touched = true;
    return { ...s, lastSeenAt: now, ip: getRequestIp(request) || s.ip, userAgent: getRequestUserAgent(request) || s.userAgent };
  });
  if (touched) SESSION_STORE.set(key, next);
}

function revokeUserSession(userId, sessionId) {
  const key = String(userId);
  const sessions = SESSION_STORE.get(key) || [];
  SESSION_STORE.set(key, sessions.filter((s) => String(s.id) !== String(sessionId)));
  REVOKED_SESSION_IDS.add(String(sessionId));
}

function clearSessionsForUser(userId) {
  const key = String(userId);
  const sessions = SESSION_STORE.get(key) || [];
  sessions.forEach((s) => REVOKED_SESSION_IDS.add(String(s.id)));
  SESSION_STORE.delete(key);
}

function isUserSoftDisabled(userId) {
  return SOFT_DISABLED_USERS.has(String(userId));
}

function getAdminRateKey(request) {
  return getRequestIp(request);
}

function registerAdminAuthFailure(rateKey) {
  const now = Date.now();
  const attempts = ADMIN_AUTH_ATTEMPTS.get(rateKey) || [];
  const filtered = attempts.filter((t) => now - t < ADMIN_RATE_LIMIT_WINDOW_MS);
  filtered.push(now);
  ADMIN_AUTH_ATTEMPTS.set(rateKey, filtered);
  if (filtered.length >= ADMIN_MAX_FAILED_ATTEMPTS) {
    ADMIN_LOCKOUTS.set(rateKey, now + ADMIN_LOCKOUT_MS);
    ADMIN_AUTH_ATTEMPTS.delete(rateKey);
  }
}

function logAdminAudit(request, action, details = {}) {
  ADMIN_AUDIT_LOGS.push({ id: randomId(10), at: new Date().toISOString(), action, ip: getRequestIp(request), userAgent: getRequestUserAgent(request), details });
  if (ADMIN_AUDIT_LOGS.length > ADMIN_AUDIT_LOG_LIMIT) ADMIN_AUDIT_LOGS.splice(0, ADMIN_AUDIT_LOGS.length - ADMIN_AUDIT_LOG_LIMIT);
}

function base32Decode(input = '') {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = String(input).toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

function hotp(secretBytes, counter) {
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  return crypto.subtle
    .importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    .then((key) => crypto.subtle.sign('HMAC', key, msg))
    .then((sig) => {
      const bytes = new Uint8Array(sig);
      const offset = bytes[bytes.length - 1] & 0x0f;
      const code = ((bytes[offset] & 0x7f) << 24) | ((bytes[offset + 1] & 0xff) << 16) | ((bytes[offset + 2] & 0xff) << 8) | (bytes[offset + 3] & 0xff);
      return String(code % 1_000_000).padStart(6, '0');
    });
}

function verifyAdminTotp(secret, suppliedCode) {
  const code = String(suppliedCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  const secretBytes = base32Decode(secret);
  if (!secretBytes.length) return false;
  const nowStep = Math.floor(Date.now() / 1000 / 30);
  const candidates = [nowStep - 1, nowStep, nowStep + 1];
  return Promise.all(candidates.map((step) => hotp(secretBytes, step)))
    .then((codes) => codes.includes(code))
    .catch(() => false);
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
  try { return JSON.parse(value); } catch { return null; }
}

function enc(s) {
  return encodeURIComponent(String(s));
}

const PREVIEW_MIME_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm',
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
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message, status = 400, code = 'bad_request') {
  return new Response(JSON.stringify({ ok: false, error: message, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const __testables = {
  enc, safeJson, parseStorageCapBytes, safeEqual, normalizePaymentCurrency,
  normalizeTransactionHash, isValidTransactionHash, isTestModeBypassHash,
  resolveTierConfig, getBtcReceivedAmount, getLtcReceivedAmount,
  getDailyBandwidthCapBytes, consumeDailyBandwidth, isPreviewableMediaFile,
  guessPreviewContentType, isPreviewContentType,
};
