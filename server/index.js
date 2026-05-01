const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const ftp = require('basic-ftp');
const http = require('http');
const https = require('https');
const { Client: SshClient } = require('ssh2');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

function fmtBytes(b) { if (!b) return '0 B'; const k=1024,s=['B','KB','MB','GB']; const i=Math.floor(Math.log(b)/Math.log(k)); return `${(b/k**i).toFixed(1)} ${s[i]}`; }

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// —— Simple admin auth (cookie session; set ADMIN_USERNAME / ADMIN_PASSWORD in env) ——
const ENV_ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim();
const ENV_ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const SESSION_COOKIE = process.env.SESSION_COOKIE || 'cwp_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7); // 7 days
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const sseClients = new Set();
const progressByClientId = new Map();
const activeBackups = new Map(); // clientId -> { cancel: boolean, startedAt: string }

function sseSend(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

function setProgress(clientId, patch) {
  const prev = progressByClientId.get(clientId) || {};
  const next = {
    ...prev,
    ...patch,
    clientId,
    ts: new Date().toISOString(),
  };
  progressByClientId.set(clientId, next);
  sseSend('progress', next);
  return next;
}

function getBackupControl(clientId) {
  return activeBackups.get(clientId) || null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [rawK, ...rawV] = part.trim().split('=');
    if (!rawK) continue;
    out[rawK] = decodeURIComponent(rawV.join('=') || '');
  }
  return out;
}

function base64UrlEncode(data) {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64');
}

function signSession(payloadB64) {
  return base64UrlEncode(crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest());
}

function createSession(username) {
  const payload = { u: username, exp: Date.now() + SESSION_TTL_MS, n: crypto.randomBytes(8).toString('hex') };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return `${payloadB64}.${signSession(payloadB64)}`;
}

function parseSession(token) {
  const t = String(token || '');
  const parts = t.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  if (sig !== signSession(payloadB64)) return null;
  let payload;
  try { payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')); }
  catch { return null; }
  if (!payload?.u || !payload?.exp) return null;
  if (Date.now() > Number(payload.exp)) return null;
  return { username: String(payload.u), expiresAt: Number(payload.exp) };
}

function getSessionFromReq(req) {
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  const cookies = parseCookies(req.headers.cookie);
  const token = bearer || cookies[SESSION_COOKIE] || '';
  if (!token) return null;
  const s = parseSession(token);
  if (!s) return null;
  return { token, ...s };
}

function clearSession(res) {
  res.cookie(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 0, path: '/' });
}

function normalizeFtpInput(ftpIn) {
  const inObj = ftpIn && typeof ftpIn === 'object' ? ftpIn : {};
  let remotePath = String(inObj.remotePath || '/').trim() || '/';
  if (!remotePath.startsWith('/')) remotePath = `/${remotePath}`;
  return {
    host: String(inObj.host || '').trim(),
    port: String(inObj.port || '21'),
    user: String(inObj.user || '').trim(),
    password: String(inObj.password || ''),
    remotePath,
    tls: Boolean(inObj.tls),
  };
}

function normalizeMysqlInput(dbIn) {
  const inObj = dbIn && typeof dbIn === 'object' ? dbIn : {};
  return {
    host: String(inObj.host || '').trim(),
    port: String(inObj.port || '3306'),
    user: String(inObj.user || '').trim(),
    password: String(inObj.password || ''),
    database: String(inObj.database || '').trim(),
    pmaUrl: String(inObj.pmaUrl || 'https://zpanel.zergaw.com:2087/pma/').trim(),
  };
}

// ─── Persistence ───────────────────────────────────────────────────────────────
function applyFtpCompatSettings(client) {
  // Some FTP servers/firewalls behave better with EPSV disabled (forces PASV).
  // basic-ftp v5 removed useEPSV/useMLSD flags; configure via prepareTransfer and availableListCommands.
  try {
    const disableEpsv = /^1|true|yes$/i.test(String(process.env.FTP_DISABLE_EPSV || '').trim());
    const pasvUseCtrlIp = /^1|true|yes$/i.test(String(process.env.FTP_PASV_USE_CTRL_IP || '').trim());

    if (pasvUseCtrlIp) {
      // Many CWP/cPanel servers sit behind NAT and advertise their *internal* IP in the
      // PASV response (e.g. 10.x.x.x). The Docker container can't reach that address, so
      // the data connection hangs and LIST times out after 45 s.
      //
      // Fix: use basic-ftp's built-in enterPassiveModeIPv4_forceControlHostIP, which
      // ignores the server-advertised IP and always uses the control socket's remote IP.
      const { enterPassiveModeIPv4_forceControlHostIP } = require('basic-ftp/dist/transfer');
      client.prepareTransfer = enterPassiveModeIPv4_forceControlHostIP;
    } else if (disableEpsv) {
      // Override prepareTransfer to use PASV directly, skipping the EPSV probe entirely.
      // This avoids the extra round-trip and prevents hangs when servers silently drop EPSV.
      client.prepareTransfer = ftp.enterPassiveModeIPv4;
    }
  } catch {}
  // Some servers choke on MLSD (esp. behind certain proxies / FTPES setups). Prefer LIST.
  try {
    const useMlsdRaw = String(process.env.FTP_USE_MLSD || '').trim();
    const useMlsd = useMlsdRaw === '' ? true : /^1|true|yes$/i.test(useMlsdRaw);
    if (!useMlsd) {
      // Force LIST-only mode; availableListCommands is set during access() but we override it
      // after access() in makeClient(). Set here as a fallback and also post-access below.
      client.availableListCommands = ['LIST -a', 'LIST'];
    }
  } catch {}
}

const DATA_FILE = path.join(__dirname, 'data', 'clients.json');
const AUTH_FILE = path.join(__dirname, 'data', 'auth.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function unb64(str) { return Buffer.from(String(str || ''), 'base64'); }
function hashPassword(password, saltBuf) {
  const salt = saltBuf || crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password || ''), salt, 64);
  return { salt: b64(salt), hash: b64(hash) };
}
function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const salt = unb64(stored.salt);
  const expected = unb64(stored.hash);
  const actual = crypto.scryptSync(String(password || ''), salt, expected.length);
  try { return crypto.timingSafeEqual(expected, actual); } catch { return false; }
}
function loadAuth() {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (raw?.username && raw?.password?.salt && raw?.password?.hash) return raw;
  } catch {}
  const seeded = {
    username: 'admin',
    password: hashPassword('admin'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  try { fs.writeFileSync(AUTH_FILE, JSON.stringify(seeded, null, 2)); } catch {}
  return seeded;
}
function saveAuth(next) {
  const clean = {
    username: String(next?.username || 'admin').trim() || 'admin',
    password: next?.password,
    createdAt: next?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(clean, null, 2));
  return clean;
}
let authStore = loadAuth();

function loadClients() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveClients(clients) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2));
}

let clients = loadClients().map(c => ({
  ...c,
  // Migrate old cwp-based clients: build ftp from cwp if ftp missing
  ftp: c.ftp || (c.cwp ? { host: c.cwp.host, port: '21', user: c.cwp.username, password: '', remotePath: '/', tls: false } : { host: '', port: '21', user: '', password: '', remotePath: '/', tls: false }),
  backup: { ftp: true },
}));

// Cleanup any leftover partial backups (from crashes/stops) on startup.
for (const c of clients) {
  const clientDir = path.join(BACKUP_DIR, String(c.id));
  cleanupStaleTmpAndPartials(clientDir, 12 * 60 * 60 * 1000);
}

let cronJobs = {};
let activityLog = [];

function log(clientId, level, message, meta = {}) {
  const entry = { id: Date.now() + Math.random(), ts: new Date().toISOString(), clientId, level, message, ...meta };
  activityLog.unshift(entry);
  if (activityLog.length > 200) activityLog.pop();
  console.log(`[${level.toUpperCase()}][${clientId}] ${message}`);
  sseSend('log', entry);
  return entry;
}

// —— Auth routes ——
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) return res.status(400).json({ error: 'username and password required' });
  const expectedUser = ENV_ADMIN_USERNAME || authStore.username;
  if (u !== expectedUser) return res.status(401).json({ error: 'Invalid credentials' });
  if (ENV_ADMIN_PASSWORD) {
    if (p !== ENV_ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid credentials' });
  } else {
    if (!verifyPassword(p, authStore.password)) return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = createSession(u);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: SESSION_TTL_MS, path: '/' });
  res.json({ success: true, user: { username: u } });
});

app.get('/api/auth/me', (req, res) => {
  const s = getSessionFromReq(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: { username: s.username } });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ success: true });
});

app.get('/api/auth/settings', (req, res) => {
  const s = getSessionFromReq(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: { username: authStore.username }, envOverridesAuth: Boolean(ENV_ADMIN_USERNAME || ENV_ADMIN_PASSWORD) });
});

app.post('/api/auth/change', (req, res) => {
  const s = getSessionFromReq(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  if (ENV_ADMIN_USERNAME || ENV_ADMIN_PASSWORD)
    return res.status(400).json({ error: 'Auth is controlled by server environment variables.' });
  const { currentPassword, newPassword, newUsername } = req.body || {};
  const cur = String(currentPassword || '');
  if (!verifyPassword(cur, authStore.password)) return res.status(401).json({ error: 'Current password is incorrect' });
  const nextUsername = String(newUsername || authStore.username).trim() || authStore.username;
  const nextPassword = String(newPassword || '');
  if (nextPassword && nextPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const next = { ...authStore, username: nextUsername };
  if (nextPassword) next.password = hashPassword(nextPassword);
  authStore = saveAuth(next);
  clearSession(res);
  res.json({ success: true, user: { username: authStore.username } });
});

// Protect remaining /api routes
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (req.path.startsWith('/auth/') || req.path === '/health') return next();
  const s = getSessionFromReq(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { username: s.username };
  next();
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.write('event: ready\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/progress', (req, res) => {
  res.json(Object.fromEntries(progressByClientId.entries()));
});

// ─── System info ───────────────────────────────────────────────────────────────
function dirStats(rootDir) {
  const stack = [rootDir];
  let files = 0, bytes = 0;
  while (stack.length) {
    const p = stack.pop();
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        files += 1;
        try { bytes += fs.statSync(full).size; } catch {}
      }
    }
  }
  return { files, bytes };
}

app.get('/api/system', (req, res) => {
  const dataBytes = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).size : 0;
  const bk = dirStats(BACKUP_DIR);
  res.json({ ok: true, now: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()), node: process.version, user: req.user, clients: { total: clients.length }, store: { dataFileBytes: dataBytes, backupsFiles: bk.files, backupsBytes: bk.bytes } });
});

// ─── FTP backup ────────────────────────────────────────────────────────────────
// Downloads all web files from the FTP remote path into localDir using
// multiple parallel connections (CONCURRENCY) for speed, then we zip them ourselves.
async function ftpDownloadDir(cfg, localDir, onProgress, shouldCancel) {
  const remoteRootRaw = String(cfg.remotePath || '/public_html') || '/public_html';
  const remoteRoot = remoteRootRaw.startsWith('/') ? remoteRootRaw : `/${remoteRootRaw}`;
  // NOTE: `basic-ftp`'s timeout applies to the FTP control socket. Large file
  // downloads can legitimately keep the control channel idle for >60s, which
  // would otherwise surface as: "Timeout (control socket)".
  const FTP_CONTROL_TIMEOUT_FALLBACK_MS = 15 * 60 * 1000; // 15 min
  const SOCKET_TIMEOUT = (() => {
    const raw = String(process.env.FTP_CONTROL_TIMEOUT_MS || '').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : FTP_CONTROL_TIMEOUT_FALLBACK_MS;
  })();
  const FTP_LIST_HARD_TIMEOUT_FALLBACK_MS = 45 * 1000;
  const LIST_HARD_TIMEOUT_MS = (() => {
    const raw = String(process.env.FTP_LIST_TIMEOUT_MS || '').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : FTP_LIST_HARD_TIMEOUT_FALLBACK_MS;
  })();
  const FTP_FILE_HARD_TIMEOUT_FALLBACK_MS = 5 * 60 * 1000;
  const FILE_HARD_TIMEOUT_MS = (() => {
    const raw = String(process.env.FTP_FILE_TIMEOUT_MS || '').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : FTP_FILE_HARD_TIMEOUT_FALLBACK_MS;
  })();
  const CONCURRENCY = (() => {
    const raw = String(process.env.FTP_CONCURRENCY || '').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  })();               // parallel download connections (default 1 — safer for firewalled servers)
  const FILE_RETRIES = 2;              // retry each file this many times on timeout/error
  const emit = (p) => { if (typeof onProgress === 'function') { try { onProgress(p); } catch {} } };

  const accessOpts = {
    host: cfg.host,
    port: Number(cfg.port || 21),
    user: cfg.user,
    password: cfg.password,
    secure: cfg.tls === true,
    secureOptions: { rejectUnauthorized: false },
  };

  async function makeClient() {
    const c = new ftp.Client(SOCKET_TIMEOUT);
    c.ftp.verbose = false;
    applyFtpCompatSettings(c);
    await c.access(accessOpts);
    // access() → useDefaultSettings() may re-set availableListCommands based on FEAT.
    // Re-apply MLSD override so the server's FEAT response doesn't re-enable MLSD.
    applyFtpCompatSettings(c);
    try { c.ftp.socket?.setKeepAlive(true, 10_000); } catch {}
    // Disable basic-ftp's built-in socket idle timeout — we manage timeouts
    // ourselves via withTimeout(). Without this, the control socket fires
    // "Timeout (control socket)" while the data socket is busy transferring.
    try { c.ftp.socket?.setTimeout(0); } catch {}
    return c;
  }

  function withTimeout(promise, ms, label, clientToClose) {
    let settled = false;
    let timeoutId;
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (clientToClose) try { clientToClose.close(); } catch {}
        reject(new Error(
          `FTP ${label} timed out after ${Math.round(ms / 1000)}s. ` +
          `This usually indicates an FTP passive-mode / firewall / NAT issue on the server.`
        ));
      }, ms);
      timeoutId.unref?.();

      Promise.resolve(promise).then(
        (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(v);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          reject(err);
        }
      );
    });
  }

  // Phase 1: scan entire directory tree with one connection
  let scanClient = await makeClient();
  const files = [];
  try {
    emit({ stage: 'scan', foundFiles: 0, current: remoteRoot });
    async function collectFiles(remotePath, localPath) {
      if (typeof shouldCancel === 'function' && shouldCancel()) throw new Error('Backup cancelled');

      // Retry the LIST a few times — some servers intermittently drop passive connections mid-scan.
      let list;
      let lastListErr;
      for (let attempt = 0; attempt <= 3; attempt++) {
        if (attempt > 0) {
          console.log(`[FTP] LIST retry ${attempt}/3 for ${remotePath}`);
          // Re-connect the scan client on a fresh connection after a failed LIST.
          try { scanClient.close(); } catch {}
          await new Promise(r => setTimeout(r, 1000 * attempt)); // back-off: 1s, 2s, 3s
          scanClient = await makeClient();
        }
        try {
          list = await withTimeout(scanClient.list(remotePath), LIST_HARD_TIMEOUT_MS, `LIST ${remotePath}`, scanClient);
          lastListErr = null;
          break;
        } catch (err) {
          if (err?.message === 'Backup cancelled') throw err;
          lastListErr = err;
        }
      }
      if (lastListErr) throw lastListErr;

      if (list.length === 0) {
        console.log(`[FTP][scan] ${remotePath}: empty directory`);
      } else {
        const sample = list.slice(0, 5).map(i => `${i.name}(type=${i.type},isFile=${i.isFile},isDir=${i.isDirectory})`).join(', ');
        console.log(`[FTP][scan] ${remotePath}: ${list.length} entries — ${sample}`);
      }
      for (const item of list) {
        if (typeof shouldCancel === 'function' && shouldCancel()) throw new Error('Backup cancelled');
        const name = String(item.name || '').trim();
        if (!name || name === '.' || name === '..') continue;
        const remoteItem = `${remotePath.replace(/\/$/, '')}/${name}`;
        const localItem = path.join(localPath, name);
        if (item.isDirectory) {
          await collectFiles(remoteItem, localItem);
        } else if (item.isFile) {
          files.push({ remote: remoteItem, local: localItem, size: item.size >= 0 ? item.size : 0 });
          if (files.length % 50 === 0) emit({ stage: 'scan', foundFiles: files.length, current: remoteItem });
        } else {
          // Symlinks and unknown types: treat as files so they aren't silently skipped.
          // basic-ftp sets type=5 for symlinks; isFile/isDirectory are both false.
          files.push({ remote: remoteItem, local: localItem, size: item.size >= 0 ? item.size : 0 });
          if (files.length % 50 === 0) emit({ stage: 'scan', foundFiles: files.length, current: remoteItem });
        }
      }
    }
    await collectFiles(remoteRoot, localDir);
  } finally {
    scanClient.close();
  }

  if (files.length === 0) throw new Error(`No files found at FTP path "${remoteRoot}". The directory may be empty, contain only symlinks that could not be read, or the FTP user may not have access. Check server logs for [FTP][scan] entries.`);

  const totalFiles = files.length;
  const totalBytes = files.reduce((a, f) => a + f.size, 0);
  emit({ stage: 'download', totalFiles, totalBytes, doneFiles: 0, doneBytes: 0, current: '' });

  // Phase 2: download in parallel with CONCURRENCY connections
  let doneFiles = 0;
  let doneBytes = 0;
  let lastEmit = 0;
  let fileIdx = 0;

  async function worker() {
    const c = await makeClient();
    try {
      while (true) {
        if (typeof shouldCancel === 'function' && shouldCancel()) throw new Error('Backup cancelled');
        const f = files[fileIdx++];
        if (!f) break;
        fs.mkdirSync(path.dirname(f.local), { recursive: true });
        const tmp = `${f.local}.part`;
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}

        // Retry loop: on timeout/error, close the stale connection and open a fresh one.
        let lastErr;
        for (let attempt = 0; attempt <= FILE_RETRIES; attempt++) {
          if (attempt > 0) {
            console.log(`[FTP] retry ${attempt}/${FILE_RETRIES} for ${f.remote}`);
            try { c.close(); } catch {}
            // Re-open a fresh connection for this worker.
            try {
              const fresh = await makeClient();
              Object.assign(c, fresh); // swap internals in-place so the outer finally still closes it
            } catch (reconnErr) {
              lastErr = reconnErr;
              break;
            }
          }
          try {
            await withTimeout(c.downloadTo(tmp, f.remote), FILE_HARD_TIMEOUT_MS, `download ${f.remote}`, c);
            lastErr = null;
            break;
          } catch (err) {
            if (err?.message === 'Backup cancelled') throw err;
            lastErr = err;
          }
        }
        if (lastErr) throw lastErr;

        fs.renameSync(tmp, f.local);
        doneFiles++;
        doneBytes += f.size;
        const now = Date.now();
        if (now - lastEmit > 350 || doneFiles === totalFiles) {
          emit({ stage: 'download', totalFiles, totalBytes, doneFiles, doneBytes, current: f.remote });
          lastEmit = now;
        }
      }
    } finally {
      c.close();
    }
  }

  fs.mkdirSync(localDir, { recursive: true });
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function ftpDownloadFile(cfg, remotePath, localPath, { timeoutMs = 15 * 60 * 1000, totalBytes = 0 } = {}, onProgress, shouldCancel) {
  const emit = (p) => { if (typeof onProgress === 'function') { try { onProgress(p); } catch {} } };
  const ftpClient = new ftp.Client(timeoutMs);
  ftpClient.ftp.verbose = false;
  applyFtpCompatSettings(ftpClient);

  let doneBytes = 0;
  ftpClient.trackProgress((info) => {
    doneBytes = Number(info?.bytesOverall || doneBytes || 0);
    emit({ stage: 'download_file', name: info?.name || path.basename(remotePath), doneBytes, totalBytes });
    try {
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        try { ftpClient.close(); } catch {}
      }
    } catch {}
  });

  try {
    await ftpClient.access({
      host: cfg.host,
      port: Number(cfg.port || 21),
      user: cfg.user,
      password: cfg.password,
      secure: cfg.tls === true,
      secureOptions: { rejectUnauthorized: false },
    });
    applyFtpCompatSettings(ftpClient); // re-apply after access() overwrites availableListCommands
    try { ftpClient.ftp.socket?.setKeepAlive(true, 10_000); } catch {}

    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    const tmpPath = `${localPath}.part`;
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    try { if (fs.existsSync(localPath)) fs.unlinkSync(localPath); } catch {}

    if (typeof shouldCancel === 'function' && shouldCancel()) throw new Error('Backup cancelled');
    await ftpClient.downloadTo(tmpPath, remotePath);
    if (typeof shouldCancel === 'function' && shouldCancel()) throw new Error('Backup cancelled');
    fs.renameSync(tmpPath, localPath);
    emit({ stage: 'download_file_done', doneBytes, totalBytes });
  } finally {
    ftpClient.trackProgress();
    ftpClient.close();
  }
}

function rmRf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

function cleanupStaleTmpAndPartials(clientDir, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    if (!fs.existsSync(clientDir)) return;
    const now = Date.now();
    const entries = fs.readdirSync(clientDir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(clientDir, e.name);
      if (e.isDirectory() && e.name.startsWith('_tmp_')) {
        try {
          const st = fs.statSync(full);
          if (maxAgeMs <= 0 || now - st.mtimeMs > maxAgeMs) rmRf(full);
        } catch {}
        continue;
      }
      if (e.isFile() && (e.name.endsWith('.part') || e.name.endsWith('.partial'))) {
        try {
          const st = fs.statSync(full);
          if (maxAgeMs <= 0 || now - st.mtimeMs > maxAgeMs) fs.unlinkSync(full);
        } catch {}
      }
    }
  } catch {}
}

function sshExec(sshCfg, command, timeoutMs = 10 * 60 * 1000, shouldCancel) {
  return new Promise((resolve, reject) => {
    const cfg = sshCfg && typeof sshCfg === 'object' ? sshCfg : {};
    const host = String(cfg.host || '').trim();
    const user = String(cfg.user || '').trim();
    const password = String(cfg.password || '');
    const port = Number(cfg.port || 22);
    if (!host) return reject(new Error('SSH host not configured'));
    if (!user) return reject(new Error('SSH username not configured'));
    if (!password) return reject(new Error('SSH password not configured'));

    const conn = new SshClient();
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { conn.end(); } catch {}
      reject(new Error('SSH timeout'));
    }, timeoutMs);

    const cancelTimer = setInterval(() => {
      try {
        if (done) return;
        if (typeof shouldCancel === 'function' && shouldCancel()) {
          done = true;
          clearTimeout(timer);
          clearInterval(cancelTimer);
          try { conn.end(); } catch {}
          reject(new Error('Backup cancelled'));
        }
      } catch {}
    }, 300);

    conn.on('ready', () => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          done = true;
          try { conn.end(); } catch {}
          return reject(err);
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (d) => (stdout += d.toString('utf8')));
        stream.stderr.on('data', (d) => (stderr += d.toString('utf8')));
        stream.on('close', (code) => {
          clearTimeout(timer);
          clearInterval(cancelTimer);
          done = true;
          try { conn.end(); } catch {}
          if (code && Number(code) !== 0) return reject(new Error((stderr || stdout || `SSH command failed (${code})`).trim()));
          resolve({ stdout, stderr, code: Number(code || 0) });
        });
      });
    });

    conn.on('error', (e) => {
      clearTimeout(timer);
      clearInterval(cancelTimer);
      if (done) return;
      done = true;
      reject(e);
    });

    conn.connect({
      host,
      port,
      username: user,
      password,
      readyTimeout: Math.min(30000, timeoutMs),
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      tryKeyboard: false,
    });
  });
}

// Creates a zip of webRoot on the remote CWP server via SSH.
// Uses `zip` if available, falls back to `tar -czf` (tar.gz).
async function createRemoteWebArchive(sshCfg, webRoot, outName, shouldCancel) {
  const root = String(webRoot || 'public_html').trim() || 'public_html';
  const outFile = String(outName || ('cwp_web_' + Date.now() + '.zip')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const rootJ = JSON.stringify(root);
  const outJ = JSON.stringify(outFile);
  // Build the shell command without JS template literals inside bash parameter expansions
  const cmd = 'sh -lc \'set -e; cd ~; ROOT=' + rootJ + '; OUT=' + outJ + '; ' +
    'if [ -d "$ROOT" ]; then :; elif [ -d "./public_html" ]; then ROOT="public_html"; fi; ' +
    'if command -v zip >/dev/null 2>&1; then ' +
    '  zip -rq "$OUT" "$ROOT"; ' +
    'else ' +
    '  OUT="${OUT%.zip}.tar.gz"; tar -czf "$OUT" "$ROOT"; ' +
    'fi; ' +
    'SZ=$(stat -c %s "$OUT" 2>/dev/null || wc -c < "$OUT"); ' +
    'echo "__CWP_ARCHIVE__$OUT__SIZE__$SZ"\'';
  const { stdout } = await sshExec(sshCfg, cmd, 20 * 60 * 1000, shouldCancel);
  const m = String(stdout || '').match(/__CWP_ARCHIVE__([a-zA-Z0-9._-]+)__SIZE__(\d+)/);
  if (!m) throw new Error('SSH archive created but could not read filename/size');
  return { fileName: m[1], size: Number(m[2] || 0) };
}

async function removeRemoteFile(sshCfg, remoteFileName) {
  const f = String(remoteFileName || '').trim();
  if (!f) return;
  const cmd = `sh -lc 'set -e; cd ~; rm -f ${JSON.stringify(f)}'`;
  await sshExec(sshCfg, cmd, 60 * 1000);
}

// Downloads a file from the remote home directory via SFTP (pure SSH, no FTP).
// Used as a fallback when FTP passive-mode data connections are blocked by a firewall.
function sshDownloadFile(sshCfg, remoteFileName, localPath, { totalBytes = 0 } = {}, onProgress, shouldCancel) {
  return new Promise((resolve, reject) => {
    const cfg = sshCfg && typeof sshCfg === 'object' ? sshCfg : {};
    const host = String(cfg.host || '').trim();
    const user = String(cfg.user || '').trim();
    const password = String(cfg.password || '');
    const port = Number(cfg.port || 22);
    const emit = (p) => { if (typeof onProgress === 'function') { try { onProgress(p); } catch {} } };

    if (!host || !user || !password) return reject(new Error('SSH credentials required for SFTP download'));

    const conn = new SshClient();
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      try { conn.end(); } catch {}
      if (err) reject(err); else resolve();
    };

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) return finish(err);

        // Resolve the remote path: if it starts with '/' treat as absolute,
        // otherwise treat as relative to the home directory.
        const remoteFile = String(remoteFileName || '').trim();
        const remotePath = remoteFile.startsWith('/') ? remoteFile : `./${remoteFile}`;

        const readStream = sftp.createReadStream(remotePath);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        const tmpPath = `${localPath}.part`;
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        const writeStream = fs.createWriteStream(tmpPath);

        let doneBytes = 0;
        let lastEmit = 0;

        readStream.on('data', (chunk) => {
          doneBytes += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 350) {
            emit({ stage: 'download_file', doneBytes, totalBytes });
            lastEmit = now;
          }
          if (typeof shouldCancel === 'function' && shouldCancel()) {
            readStream.destroy();
            writeStream.destroy();
            finish(new Error('Backup cancelled'));
          }
        });

        readStream.on('error', (e) => {
          writeStream.destroy();
          finish(e);
        });

        writeStream.on('error', (e) => {
          readStream.destroy();
          finish(e);
        });

        writeStream.on('finish', () => {
          try { fs.renameSync(tmpPath, localPath); } catch (e) { return finish(e); }
          emit({ stage: 'download_file_done', doneBytes, totalBytes });
          finish(null);
        });

        readStream.pipe(writeStream);
      });
    });

    conn.on('error', finish);

    conn.connect({
      host,
      port,
      username: user,
      password,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      tryKeyboard: false,
    });
  });
}


// Connects, lists the remote path for a .zip, downloads it, deletes the remote copy.
// Uses a short 90s socket timeout so a stuck data connection fails fast instead of
// hanging for 15+ minutes (the classic FTP passive-mode firewall hang).
async function ftpFetchCwpWebZip(cfg, destDir, onProgress, shouldCancel) {
  const remotePath = String(cfg.remotePath || '/').trim() || '/';
  // 90s per-operation socket timeout — prevents the FTP LIST data-connection from
  // hanging forever when a firewall silently drops passive-mode packets.
  const FTP_CONTROL_TIMEOUT_FALLBACK_MS = 90 * 1000;
  const SOCKET_TIMEOUT = (() => {
    const raw = String(process.env.FTP_CONTROL_TIMEOUT_MS || '').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : FTP_CONTROL_TIMEOUT_FALLBACK_MS;
  })();
  const DOWNLOAD_TIMEOUT = 20 * 60 * 1000; // 20 min max for the actual file transfer
  const emit = (p) => { if (typeof onProgress === 'function') { try { onProgress(p); } catch {} } };

  // Helper: run fn with a hard timeout. Pass clientToClose to cancel the FTP operation immediately on timeout.
  function withTimeout(promise, ms, label, clientToClose) {
    let settled = false;
    let timeoutId;
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (clientToClose) try { clientToClose.close(); } catch {}
        reject(new Error(`FTP ${label} timed out after ${ms / 1000}s. Check FTP passive mode / firewall settings.`));
      }, ms);
      timeoutId.unref?.();

      Promise.resolve(promise).then(
        (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(v);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          reject(err);
        }
      );
    });
  }

  const ftpClient = new ftp.Client(SOCKET_TIMEOUT);
  ftpClient.ftp.verbose = false;
  applyFtpCompatSettings(ftpClient);

  try {
    // 1. Connect
    await withTimeout(ftpClient.access({
      host: cfg.host,
      port: Number(cfg.port || 21),
      user: cfg.user,
      password: cfg.password,
      secure: cfg.tls === true,
      secureOptions: { rejectUnauthorized: false },
    }), 30 * 1000, 'connect', ftpClient);
    applyFtpCompatSettings(ftpClient); // re-apply after access() overwrites availableListCommands
    try { ftpClient.ftp.socket?.setKeepAlive(true, 10_000); } catch {}

    if (typeof shouldCancel === 'function' && shouldCancel()) throw new Error('Backup cancelled');

    // 2. List — wrap with 30s hard timeout so a hung data channel fails fast
    emit({ stage: 'scan', message: 'Listing FTP path for CWP web zip…' });
    const list = await withTimeout(ftpClient.list(remotePath), 30 * 1000, `LIST ${remotePath}`, ftpClient);

    const zipFiles = list.filter(f => f.isFile && /\.zip$/i.test(String(f.name || '')));

    if (zipFiles.length === 0) {
      const names = list.slice(0, 10).map(f => f.name).join(', ') || '(empty)';
      throw new Error(
        `No .zip file found in FTP path "${remotePath}". ` +
        `Files found: ${names}. ` +
        `Make sure CWP has created a web backup zip in that directory.`
      );
    }

    // Pick largest zip (most recent full backup)
    const target = zipFiles.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    const remoteFile = remotePath.endsWith('/') ? `${remotePath}${target.name}` : `${remotePath}/${target.name}`;
    const totalBytes = target.size || 0;

    // 3. Download to .part then rename (atomic)
    fs.mkdirSync(destDir, { recursive: true });
    const localZipTmp = path.join(destDir, `_cwp_web.zip.part`);
    const localZip = path.join(destDir, `web.zip`);
    try { if (fs.existsSync(localZipTmp)) fs.unlinkSync(localZipTmp); } catch {}
    try { if (fs.existsSync(localZip)) fs.unlinkSync(localZip); } catch {}

    emit({ stage: 'download', totalBytes, doneBytes: 0, current: target.name });
    ftpClient.trackProgress((info) => {
      const doneBytes = Number(info?.bytesOverall || 0);
      emit({ stage: 'download', totalBytes, doneBytes, current: target.name });
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        try { ftpClient.close(); } catch {}
      }
    });

    await withTimeout(ftpClient.downloadTo(localZipTmp, remoteFile), DOWNLOAD_TIMEOUT, `download ${target.name}`, ftpClient);
    ftpClient.trackProgress();

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      try { fs.unlinkSync(localZipTmp); } catch {}
      throw new Error('Backup cancelled');
    }

    fs.renameSync(localZipTmp, localZip);

    // 4. Delete the remote CWP zip — safe now that we have it locally
    try { await withTimeout(ftpClient.remove(remoteFile), 15 * 1000, `delete ${target.name}`, ftpClient); }
    catch (e) { console.warn(`[WARN] Could not delete remote CWP zip ${remoteFile}: ${e.message}`); }

    emit({ stage: 'done', message: 'CWP web zip downloaded, remote deleted' });
    return { localZip, fileName: target.name, size: totalBytes };
  } finally {
    try { ftpClient.trackProgress(); } catch {}
    ftpClient.close();
  }
}

// STORE mode (zlib level 0): files like .zip and .sql.gz are already compressed —
// re-compressing them wastes CPU time and barely reduces size. Just store them.
function zipDirectory(sourceDir, outPath, onProgress) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 0 } });
    output.on('close', () => resolve({ bytes: archive.pointer() }));
    output.on('error', reject);
    archive.on('warning', err => (err.code === 'ENOENT' ? null : reject(err)));
    archive.on('error', reject);
    if (typeof onProgress === 'function') {
      archive.on('progress', (p) => {
        try { onProgress(p); } catch {}
      });
    }
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

// ─── MySQL dump ────────────────────────────────────────────────────────────────
function parseSetCookie(setCookieHeader) {
  const out = {};
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : (setCookieHeader ? [setCookieHeader] : []);
  for (const h of headers) {
    const first = String(h || '').split(';')[0] || '';
    const idx = first.indexOf('=');
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

function mergeCookies(jar, setCookieHeader) {
  const parsed = parseSetCookie(setCookieHeader);
  for (const [k, v] of Object.entries(parsed)) jar[k] = v;
}

function cookieHeaderFromJar(jar) {
  const parts = [];
  for (const [k, v] of Object.entries(jar || {})) parts.push(`${k}=${v}`);
  return parts.join('; ');
}

function guessPmaToken(html) {
  const s = String(html || '');
  const m =
    s.match(/name=[\"']token[\"'][^>]*value=[\"']([^\"']+)[\"']/i) ||
    s.match(/token:\\s*[\"']([^\"']+)[\"']/i);
  return m ? String(m[1] || '') : '';
}

function guessFormAction(html, predicate = () => true) {
  const s = String(html || '');
  const formRe = /<form\\b[^>]*>/ig;
  let match;
  while ((match = formRe.exec(s))) {
    const tag = match[0];
    if (!predicate(tag)) continue;
    const am = tag.match(/\\baction=[\"']([^\"']+)[\"']/i);
    if (am) return String(am[1] || '');
    return '';
  }
  return '';
}

function collectHiddenInputs(html) {
  const s = String(html || '');
  const out = {};
  const inputRe = /<input\\b[^>]*>/ig;
  let match;
  while ((match = inputRe.exec(s))) {
    const tag = match[0];
    if (!/\\btype=[\"']hidden[\"']/i.test(tag)) continue;
    const nameM = tag.match(/\\bname=[\"']([^\"']+)[\"']/i);
    if (!nameM) continue;
    const name = String(nameM[1] || '');
    const valueM = tag.match(/\\bvalue=[\"']([^\"']*)[\"']/i);
    const value = valueM ? String(valueM[1] || '') : '';
    if (name) out[name] = value;
  }
  return out;
}

function ensureTrailingSlash(urlStr) {
  const u = new URL(String(urlStr || '').trim());
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

function requestOnce(urlStr, { method = 'GET', headers = {}, body = null, jar = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const proto = isHttps ? https : http;

    const reqHeaders = {
      'User-Agent': 'cwp-backup-system/1.0',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      ...headers,
    };
    const cookie = cookieHeaderFromJar(jar);
    if (cookie) reqHeaders.Cookie = cookie;

    const req = proto.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: reqHeaders,
      rejectUnauthorized: false,
    }, (res) => {
      mergeCookies(jar, res.headers['set-cookie']);

      const chunks = [];
      let bytes = 0;
      res.on('data', (c) => {
        chunks.push(c);
        bytes += c.length;
        if (bytes > 8 * 1024 * 1024) {
          req.destroy();
          reject(new Error('phpMyAdmin response too large'));
        }
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body: Buffer.concat(chunks),
        });
      });
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestFollow(urlStr, opts = {}) {
  const jar = opts.jar || {};
  let url = urlStr;
  let method = opts.method || 'GET';
  let headers = opts.headers || {};
  let body = opts.body || null;
  const maxRedirects = Number(opts.maxRedirects || 15);
  const history = [];

  for (let i = 0; i <= maxRedirects; i += 1) {
    const res = await requestOnce(url, { method, headers, body, jar, timeoutMs: opts.timeoutMs || 20000 });
    const sc = res.statusCode;
    const loc = res.headers && res.headers.location ? String(res.headers.location) : '';
    const isRedirect = [301, 302, 303, 307, 308].includes(sc) && loc;
    if (!isRedirect) return res;

    history.push({ sc, method, url, loc });
    const nextU = new URL(loc, url);
    if (!nextU.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(nextU.pathname)) nextU.pathname += '/';
    url = nextU.toString();

    // Browsers switch POST -> GET on 301/302/303. This is important for login flows.
    const shouldSwitchToGet = method !== 'GET' && (sc === 301 || sc === 302 || sc === 303);
    if (shouldSwitchToGet) {
      method = 'GET';
      body = null;
      headers = { ...headers };
      delete headers['Content-Type'];
      delete headers['content-type'];
      delete headers['Content-Length'];
      delete headers['content-length'];
    }

    // Detect loops early to return a useful error.
    const visited = history.map(h => h.url);
    const last = visited.slice(-6);
    const uniq = new Set(last);
    if (last.length >= 6 && uniq.size <= 2) break;
  }

  const tail = history.slice(-10).map(h => `${h.method} ${h.sc} ${h.url} -> ${h.loc}`).join(' | ');
  throw new Error(`Too many redirects while contacting phpMyAdmin: ${tail || urlStr}`);
}

async function downloadToFile(urlStr, { method = 'POST', headers = {}, body, jar = {}, timeoutMs = 60000 } = {}, outFile) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const proto = isHttps ? https : http;

    const reqHeaders = {
      'User-Agent': 'cwp-backup-system/1.0',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      ...headers,
    };
    const cookie = cookieHeaderFromJar(jar);
    if (cookie) reqHeaders.Cookie = cookie;

    const fileStream = fs.createWriteStream(outFile);
    let firstBytes = Buffer.alloc(0);

    const req = proto.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: reqHeaders,
      rejectUnauthorized: false,
    }, (res) => {
      mergeCookies(jar, res.headers['set-cookie']);

      const sc = res.statusCode || 0;
      const loc = res.headers && res.headers.location ? String(res.headers.location) : '';
      if ([301, 302, 303, 307, 308].includes(sc) && loc) {
        fileStream.close();
        try { fs.unlinkSync(outFile); } catch {}
        const nextU = new URL(loc, urlStr);
        if (!nextU.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(nextU.pathname)) nextU.pathname += '/';
        const nextUrl = nextU.toString();
        const shouldSwitchToGet = method !== 'GET' && (sc === 301 || sc === 302 || sc === 303);
        const nextMethod = shouldSwitchToGet ? 'GET' : (sc === 303 ? 'GET' : method);
        const nextHeaders = { ...headers };
        if (nextMethod === 'GET') {
          delete nextHeaders['Content-Type'];
          delete nextHeaders['content-type'];
          delete nextHeaders['Content-Length'];
          delete nextHeaders['content-length'];
        }
        return downloadToFile(nextUrl, { method: nextMethod, headers: nextHeaders, body: nextMethod === 'GET' ? null : body, jar, timeoutMs }, outFile)
          .then(resolve, reject);
      }

      res.on('data', (c) => {
        if (firstBytes.length < 4096) {
          const remaining = 4096 - firstBytes.length;
          firstBytes = Buffer.concat([firstBytes, c.slice(0, remaining)]);
        }
      });

      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => {
          const ct = String(res.headers['content-type'] || '');
          const looksHtml = ct.includes('text/html') || /^\s*</.test(firstBytes.toString('utf8'));
          if (looksHtml) {
            try { fs.unlinkSync(outFile); } catch {}
            const snippet = firstBytes.toString('utf8').replace(/\s+/g, ' ').slice(0, 220);
            console.log(`[DB] export POST returned HTTP ${sc} (${ct}) — HTML response. URL was: ${urlStr}`);
            return reject(new Error(`phpMyAdmin returned HTML instead of a dump (${ct || 'no content-type'}): ${snippet}`));
          }
          resolve({ statusCode: sc, headers: res.headers || {} });
        });
      });
      fileStream.on('error', (e) => {
        try { fs.unlinkSync(outFile); } catch {}
        reject(e);
      });
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')));
    req.on('error', (e) => {
      try { fs.unlinkSync(outFile); } catch {}
      reject(e);
    });
    if (body) req.write(body);
    req.end();
  });
}

async function phpMyAdminVerify(cfg) {
  const base = ensureTrailingSlash(cfg.pmaUrl || '');
  const jar = {};

  const loginPage = await requestFollow(base.toString(), { method: 'GET', jar, timeoutMs: 20000 });
  const loginHtml = loginPage.body.toString('utf8');

  const token = guessPmaToken(loginHtml);
  const action = guessFormAction(loginHtml, (tag) => /login/i.test(tag) || /index\\.php/i.test(tag)) || 'index.php';
  const actionUrl = new URL(action, base).toString();

  const serverM =
    loginHtml.match(/\\bname=[\"']server[\"'][^>]*>\\s*<option[^>]*value=[\"'](\\d+)[\"']/i) ||
    loginHtml.match(/\\bname=[\"']server[\"'][^>]*value=[\"'](\\d+)[\"']/i);
  const server = serverM ? String(serverM[1] || '1') : '1';

  const loginBody = new URLSearchParams();
  if (token) loginBody.set('token', token);
  loginBody.set('pma_username', cfg.user);
  loginBody.set('pma_password', cfg.password);
  loginBody.set('server', server);

  await requestFollow(actionUrl, {
    method: 'POST',
    jar,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': base.toString(), 'Origin': base.origin },
    body: loginBody.toString(),
    timeoutMs: 25000,
  });

  const exportCandidates = [
    new URL(`export.php?db=${encodeURIComponent(cfg.database)}`, base).toString(),
    new URL(`index.php?route=/export&db=${encodeURIComponent(cfg.database)}`, base).toString(),
  ];

  let exportPage = null;
  for (const u of exportCandidates) {
    const r = await requestFollow(u, { method: 'GET', jar, timeoutMs: 25000 });
    const html = r.body.toString('utf8');
    if (/name=[\"']pma_username[\"']/.test(html)) continue;
    if (!guessPmaToken(html)) continue;
    exportPage = { url: u, html };
    console.log(`[DB] export page loaded from: ${u}`);
    break;
  }

  if (!exportPage) throw new Error('phpMyAdmin login failed or export page unavailable (check credentials, URL, and db name)');
  return { base, jar, exportHtml: exportPage.html };
}

// Dumps a specific database to outFile (.sql.gz) using phpMyAdmin (no direct MySQL connection required).
async function mysqlDump(client, outFile) {
  const cfg = client.db;
  if (!cfg?.pmaUrl) throw new Error('phpMyAdmin URL not configured');
  if (!cfg?.user) throw new Error('MySQL username not configured');
  if (!cfg?.password) throw new Error('MySQL password not configured');
  if (!cfg?.database) throw new Error('MySQL database name not configured');

  // Build a list of URLs to try: configured URL first, then common CWP/cPanel patterns
  // derived from the FTP host. This handles the case where the configured pmaUrl is stale.
  const ftpHost = client.ftp?.host || client.cwp?.host || '';
  const cwpPort = client.cwp?.port || '2304';
  const candidateUrls = [cfg.pmaUrl];
  if (ftpHost) {
    const extras = [
      `https://${ftpHost}:2087/pma/`,
      `https://${ftpHost}:2087/phpMyAdmin/`,
      `http://${ftpHost}:2083/pma/`,
      `https://${ftpHost}:${cwpPort}/pma/`,
      `http://${ftpHost}:2082/pma/`,
    ];
    for (const u of extras) {
      if (!candidateUrls.includes(u)) candidateUrls.push(u);
    }
  }

  let verifyResult = null;
  let lastVerifyErr = null;
  for (const url of candidateUrls) {
    try {
      verifyResult = await phpMyAdminVerify({ ...cfg, pmaUrl: url });
      // If we succeeded with a different URL, log it so the user knows to update their config.
      if (url !== cfg.pmaUrl) {
        console.log(`[DB] pmaUrl "${cfg.pmaUrl}" failed — succeeded with "${url}". Update the client config.`);
      }
      break;
    } catch (e) {
      lastVerifyErr = e;
    }
  }
  if (!verifyResult) throw lastVerifyErr || new Error('phpMyAdmin login failed on all candidate URLs');

  const { base, jar, exportHtml } = verifyResult;

  const exportToken = guessPmaToken(exportHtml);
  if (!exportToken) throw new Error('Could not find phpMyAdmin token (export page)');

  const exportAction =
    guessFormAction(exportHtml, (tag) => /export/i.test(tag)) ||
    guessFormAction(exportHtml, () => true) ||
    'index.php?route=/export';
  // Normalise: some PMA versions use export.php but modern ones route through index.php.
  // If the form action is bare "export.php" with no route, rewrite to the modern route.
  const exportActionRaw = exportAction === 'export.php' ? 'index.php?route=/export' : exportAction;
  const exportActionUrl = new URL(exportActionRaw, base).toString();
  console.log(`[DB] export POST → ${exportActionUrl}`);

  const hidden = collectHiddenInputs(exportHtml);
  const exportBody = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) exportBody.set(k, v);

  exportBody.set('token', exportToken);
  exportBody.set('db', cfg.database);
  exportBody.set('export_type', exportBody.get('export_type') || 'database');
  exportBody.set('export_method', 'quick');
  exportBody.set('quick_or_custom', 'quick');
  exportBody.set('output_format', 'sendit');
  exportBody.set('compression', 'gzip');
  exportBody.set('what', exportBody.get('what') || 'sql');
  exportBody.set('sql_structure_or_data', exportBody.get('sql_structure_or_data') || 'structure_and_data');

  await downloadToFile(exportActionUrl, {
    method: 'POST',
    jar,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': base.toString(), 'Origin': base.origin },
    body: exportBody.toString(),
    timeoutMs: 5 * 60 * 1000,
  }, outFile);

  const size = fs.statSync(outFile).size;
  if (size <= 0) throw new Error('phpMyAdmin export produced an empty file');
  return { file: outFile, size, databases: [cfg.database] };
}

// ─── Core backup runner ────────────────────────────────────────────────────────
// Downloads web files via FTP + dumps MySQL, packages both into one ZIP.
// trigger: 'manual' (visible in UI) | 'scheduled' (runs silently, not stored)
async function runClientBackup(clientId, trigger = 'manual') {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (activeBackups.has(clientId)) {
    log(clientId, 'warn', 'Backup already running for this client');
    return;
  }

  log(clientId, 'info', `🚀 Starting backup for ${client.name}`);

  setProgress(clientId, { status: 'running', stage: 'starting', percent: 0, message: 'Starting backup…' });

  activeBackups.set(clientId, { cancel: false, paused: false, startedAt: new Date().toISOString() });
  const shouldCancel = () => Boolean(activeBackups.get(clientId)?.cancel);
  const waitIfPaused = async () => {
    while (activeBackups.get(clientId)?.paused && !activeBackups.get(clientId)?.cancel) {
      await new Promise(r => setTimeout(r, 300));
    }
    if (activeBackups.get(clientId)?.cancel) throw new Error('Backup cancelled');
  };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const clientDir = path.join(BACKUP_DIR, String(client.id));
  const tmpDir = path.join(clientDir, `_tmp_${ts}`);
  cleanupStaleTmpAndPartials(clientDir, 6 * 60 * 60 * 1000);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    client.backups = client.backups || [];
    const ftpCfg = normalizeFtpInput(client.ftp);

    // 1. Download web files via FTP into tmp/web/
    log(clientId, 'info', `FTP: connecting to ${ftpCfg.host} → ${ftpCfg.remotePath}...`);
    setProgress(clientId, { status: 'running', stage: 'ftp', percent: 5, message: 'FTP: scanning…' });



    const ftpBase = 5;
    const ftpSpan = 65;

    const archiveCfg = client.webArchive || client.web?.archive || null;
    const archiveEnabled = Boolean(archiveCfg?.enabled);
    let remoteArchiveFile = '';

    if (archiveEnabled) {
      const sshCfg = archiveCfg.ssh || {};
      const webRoot = archiveCfg.webRoot || 'public_html';

      setProgress(clientId, { status: 'running', stage: 'web_archive_create', percent: ftpBase, message: 'Web: creating archive on server (SSH)...' });
      const outName = `cwp_web_${String(client.domain || client.name).replace(/[^a-zA-Z0-9._-]/g, '_')}_${ts}.tar.gz`;
      const { fileName, size: remoteSize } = await createRemoteWebArchive(sshCfg, webRoot, outName, shouldCancel);
      remoteArchiveFile = fileName;

      setProgress(clientId, { status: 'running', stage: 'web_archive_download', percent: ftpBase + 2, message: `Web: downloading archive (${fileName})...` });
      const localArchive = path.join(tmpDir, `${String(client.domain || client.name).replace(/[^a-zA-Z0-9._-]/g, '_')}_web_${ts}.tar.gz`);
      await ftpDownloadFile(ftpCfg, `/${fileName}`, localArchive, { totalBytes: remoteSize }, (p) => {
        const ratio = p.totalBytes ? (p.doneBytes / p.totalBytes) : 0;
        const pct = ftpBase + Math.max(0, Math.min(ftpSpan, ftpSpan * (Number.isFinite(ratio) ? ratio : 0)));
        setProgress(clientId, { status: 'running', stage: 'web_archive_download', percent: pct, message: 'Web: downloading archive...', detail: p });
      }, shouldCancel);

      setProgress(clientId, { status: 'running', stage: 'web_archive_cleanup', percent: 70, message: 'Web: deleting remote archive...' });
      await removeRemoteFile(sshCfg, fileName).catch(() => {});
      remoteArchiveFile = '';

      log(clientId, 'info', `FTP: downloaded web archive ${fileName}`);
      setProgress(clientId, { status: 'running', stage: 'ftp_done', percent: 70, message: 'Web: archive downloaded' });
    } else {
      // Download all web files via FTP (4 parallel connections) into tmp/web/,
      // then we zip them ourselves into the final backup.
      // If FTP LIST times out (passive-mode firewall block), automatically fall back
      // to SSH archive: zip on the server via SSH, download the archive via FTP.
      const webDir = path.join(tmpDir, 'web');
      let ftpFailed = false;
      let ftpError = null;
      try {
        await ftpDownloadDir(ftpCfg, webDir, (p) => {
          if (p.stage === 'scan') {
            setProgress(clientId, { status: 'running', stage: 'ftp_scan', percent: ftpBase, message: `FTP: scanning… ${p.foundFiles || 0} file(s)` });
          } else if (p.stage === 'download') {
            const ratio = p.totalBytes ? (p.doneBytes / p.totalBytes) : (p.totalFiles ? (p.doneFiles / p.totalFiles) : 0);
            const pct = ftpBase + Math.max(0, Math.min(ftpSpan, ftpSpan * (Number.isFinite(ratio) ? ratio : 0)));
            setProgress(clientId, { status: 'running', stage: 'ftp_download', percent: pct, message: `FTP: ${p.doneFiles || 0}/${p.totalFiles || 0} files — ${fmtBytes(p.doneBytes)} / ${fmtBytes(p.totalBytes)}`, detail: p });
          }
        }, shouldCancel);
        log(clientId, 'info', `FTP: ${ftpCfg.remotePath} downloaded`);
        setProgress(clientId, { status: 'running', stage: 'ftp_done', percent: 70, message: 'FTP: download complete' });
      } catch (ftpErr) {
        if (ftpErr?.message === 'Backup cancelled') throw ftpErr;
        ftpFailed = true;
        ftpError = ftpErr;
      }

      if (ftpFailed) {
        // Build SSH config from webArchive.ssh (explicit) or fall back to cwp credentials.
        const cwp = client.cwp || {};
        const sshFallback = client.webArchive?.ssh?.host
          ? client.webArchive.ssh
          : {
              host: cwp.host || ftpCfg.host,
              port: String(cwp.sshPort || '22'),
              user: cwp.username || ftpCfg.user,
              // Try rootPassword first, then the FTP password as a last resort
              // (on many CWP servers the cPanel user's FTP and SSH passwords are the same).
              password: cwp.rootPassword || ftpCfg.password || '',
            };

        const hasSsh = sshFallback.host && sshFallback.user && sshFallback.password;
        if (!hasSsh) {
          // No SSH credentials available — re-throw the original FTP error.
          throw ftpError;
        }

        log(clientId, 'warn', `FTP failed (${ftpError?.message}). Falling back to SSH archive method…`);
        setProgress(clientId, { status: 'running', stage: 'ssh_fallback', percent: ftpBase, message: 'FTP failed — falling back to SSH archive…' });

        const webRoot = client.webArchive?.webRoot || 'public_html';
        const outName = `cwp_web_${String(client.domain || client.name).replace(/[^a-zA-Z0-9._-]/g, '_')}_${ts}.tar.gz`;

        setProgress(clientId, { status: 'running', stage: 'web_archive_create', percent: ftpBase + 2, message: 'SSH: creating archive on server…' });
        let remoteArchiveFileFallback = '';
        try {
          const { fileName, size: remoteSize } = await createRemoteWebArchive(sshFallback, webRoot, outName, shouldCancel);
          remoteArchiveFileFallback = fileName;

          setProgress(clientId, { status: 'running', stage: 'web_archive_download', percent: ftpBase + 5, message: `SSH: downloading archive (${fileName})…` });
          const localArchive = path.join(tmpDir, `${String(client.domain || client.name).replace(/[^a-zA-Z0-9._-]/g, '_')}_web_${ts}.tar.gz`);
          await sshDownloadFile(sshFallback, fileName, localArchive, { totalBytes: remoteSize }, (p) => {
            const ratio = p.totalBytes ? (p.doneBytes / p.totalBytes) : 0;
            const pct = ftpBase + Math.max(0, Math.min(ftpSpan, ftpSpan * (Number.isFinite(ratio) ? ratio : 0)));
            setProgress(clientId, { status: 'running', stage: 'web_archive_download', percent: pct, message: 'SSH: downloading archive…', detail: p });
          }, shouldCancel);

          setProgress(clientId, { status: 'running', stage: 'web_archive_cleanup', percent: 70, message: 'SSH: deleting remote archive…' });
          await removeRemoteFile(sshFallback, fileName).catch(() => {});
          remoteArchiveFileFallback = '';

          log(clientId, 'info', `SSH fallback: downloaded web archive ${fileName}`);
          setProgress(clientId, { status: 'running', stage: 'ftp_done', percent: 70, message: 'SSH fallback: archive downloaded' });
        } catch (sshErr) {
          if (remoteArchiveFileFallback) await removeRemoteFile(sshFallback, remoteArchiveFileFallback).catch(() => {});
          if (sshErr?.message === 'Backup cancelled') throw sshErr;
          // SSH also failed — throw a combined error so the user knows both were tried.
          throw new Error(`FTP failed: ${ftpError?.message} | SSH fallback also failed: ${sshErr?.message}`);
        }
      }
    }

    // 2. Export DB via phpMyAdmin into tmp/<db>.sql.gz
    await waitIfPaused();
    log(clientId, 'info', `DB: exporting ${client.db.database} via phpMyAdmin...`);
    setProgress(clientId, { status: 'running', stage: 'db_export', percent: 75, message: 'DB: exporting via phpMyAdmin…' });
    const sqlFile = path.join(tmpDir, `${client.db.database}.sql.gz`);
    if (shouldCancel()) throw new Error('Backup cancelled');
    await mysqlDump(client, sqlFile);
    log(clientId, 'info', 'DB: export complete');
    setProgress(clientId, { status: 'running', stage: 'db_done', percent: 85, message: 'DB: export complete' });

    // 3. Pack everything (web/ + sql.gz) into a single ZIP (write to .part then rename)
    const zipName = `backup_${(client.domain || client.name).replace(/[^a-zA-Z0-9._-]/g, '_')}_${ts}.zip`;
    const zipPath = path.join(clientDir, zipName);
    const zipTmpPath = `${zipPath}.part`;
    setProgress(clientId, { status: 'running', stage: 'zip', percent: 86, message: 'Zipping…' });
    const zipBase = 85;
    const zipSpan = 13;
    await zipDirectory(tmpDir, zipTmpPath, (p) => {
      const processed = p?.entries?.processed || 0;
      const total = p?.entries?.total || 0;
      const ratio = total ? (processed / total) : 0;
      const pct = zipBase + Math.max(0, Math.min(zipSpan, zipSpan * (Number.isFinite(ratio) ? ratio : 0)));
      setProgress(clientId, { status: 'running', stage: 'zip', percent: pct, message: total ? `Zipping… ${processed}/${total}` : 'Zipping…' });
    });
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch {}
    fs.renameSync(zipTmpPath, zipPath);
    const size = fs.statSync(zipPath).size;

    // Only store backup entry for manual runs — scheduled runs are silent
    if (trigger === 'manual') {
      client.backups.unshift({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        name: zipName,
        type: 'zip',
        size,
        date: new Date().toISOString(),
        source: 'manual',
        localPath: zipPath,
        status: 'ok',
      });
    } else {
      // Scheduled: don't keep the zip, just update lastBackup time
      try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch {}
    }

    client.lastBackup = new Date().toISOString();
    client.status = 'ok';
    saveClients(clients);
    setProgress(clientId, { status: 'done', stage: 'done', percent: 100, message: `Backup complete (${(size / 1024 / 1024).toFixed(2)} MB)`, file: zipName });
    setTimeout(() => progressByClientId.delete(clientId), 10 * 60 * 1000).unref?.();
    log(clientId, 'info', `🎉 Backup complete — ${zipName} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (err) {
    const wasCancelled = String(err?.message || '').includes('cancelled');
    client.status = wasCancelled ? 'ok' : 'error';
    saveClients(clients);
    // Clean up any partial files completely
    cleanupStaleTmpAndPartials(clientDir, 0);
    setProgress(clientId, { status: wasCancelled ? 'cancelled' : 'error', stage: 'error', message: String(err?.message || err || 'Backup failed') });
    setTimeout(() => progressByClientId.delete(clientId), 10 * 60 * 1000).unref?.();
    log(clientId, wasCancelled ? 'warn' : 'error', `${wasCancelled ? '⏹️ Backup stopped' : '❌ Backup failed'} for ${client.name}: ${err.message}${err.stack ? '\n' + err.stack : ''}`);
  } finally {
    activeBackups.delete(clientId); // Always release the lock so new backups can start
    rmRf(tmpDir);
  }
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────
function scheduleClient(client) {
  if (cronJobs[client.id]) cronJobs[client.id].stop();
  const schedule = String(client.schedule || '02:00').trim();

  const days = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  let dow = 0; // Sunday
  let hour = 2;
  let minute = 0;

  const m1 = schedule.match(/^(\d{1,2}):(\d{2})$/); // legacy: time only
  const m2 = schedule.match(/^([a-z]{3})\s+(\d{1,2}):(\d{2})$/i); // "Mon 02:00"
  const m3 = schedule.match(/^([0-6])\s+(\d{1,2}):(\d{2})$/); // "1 02:00"

  if (m2) {
    dow = days[String(m2[1]).toLowerCase()] ?? 0;
    hour = Number(m2[2]);
    minute = Number(m2[3]);
  } else if (m3) {
    dow = Number(m3[1]);
    hour = Number(m3[2]);
    minute = Number(m3[3]);
  } else if (m1) {
    dow = 0;
    hour = Number(m1[1]);
    minute = Number(m1[2]);
  } else {
    log(client.id, 'warn', `Invalid schedule "${schedule}", falling back to Sun 02:00 UTC`);
    dow = 0; hour = 2; minute = 0;
  }

  if (![0,1,2,3,4,5,6].includes(dow) || !Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59 || hour < 0 || minute < 0) {
    log(client.id, 'warn', `Invalid schedule "${schedule}", falling back to Sun 02:00 UTC`);
    dow = 0; hour = 2; minute = 0;
  }

  cronJobs[client.id] = cron.schedule(
    `${minute} ${hour} * * ${dow}`,
    () => runClientBackup(client.id, 'scheduled'),
    { timezone: 'UTC' }
  );

  const dayName = Object.keys(days).find(k => days[k] === dow) || 'sun';
  log(client.id, 'info', `Scheduled weekly on ${dayName.toUpperCase()} at ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} UTC`);
}

clients.forEach(scheduleClient);

// ─── Routes ────────────────────────────────────────────────────────────────────

function maskClient(c) {
  return {
    ...c,
    ftp: { ...c.ftp, password: c.ftp?.password ? '****' : '' },
    db: c.db ? { ...c.db, password: c.db?.password ? '****' : '' } : undefined,
    webArchive: c.webArchive
      ? {
          ...c.webArchive,
          ssh: c.webArchive.ssh
            ? { ...c.webArchive.ssh, password: c.webArchive.ssh?.password ? '****' : '' }
            : undefined,
        }
      : undefined,
  };
}

app.get('/api/clients', (req, res) => {
  res.json(clients.map(maskClient));
});

app.post('/api/clients', async (req, res) => {
  const { name, domain, plan, schedule, ftp: ftpRaw, db: dbRaw } = req.body;
  const ftpCfg = normalizeFtpInput(ftpRaw);
  const dbCfg = normalizeMysqlInput(dbRaw);

  if (!name) return res.status(400).json({ error: 'name required' });
  if (!ftpCfg.host) return res.status(400).json({ error: 'FTP host required' });
  if (!ftpCfg.user) return res.status(400).json({ error: 'FTP username required' });
  if (!ftpCfg.password) return res.status(400).json({ error: 'FTP password required' });
  if (!dbCfg.user) return res.status(400).json({ error: 'MySQL username required' });
  if (!dbCfg.password) return res.status(400).json({ error: 'MySQL password required' });
  if (!dbCfg.database) return res.status(400).json({ error: 'MySQL database name required' });
  if (!dbCfg.pmaUrl) return res.status(400).json({ error: 'phpMyAdmin URL required' });

  // Test FTP — required, fail hard
  const ftpTest = new ftp.Client(10000);
  try {
    await ftpTest.access({
      host: ftpCfg.host,
      port: Number(ftpCfg.port || 21),
      user: ftpCfg.user,
      password: ftpCfg.password,
      secure: ftpCfg.tls === true,
      secureOptions: { rejectUnauthorized: false },
    });
    await ftpTest.list(ftpCfg.remotePath || '/public_html');
  } catch (e) {
    return res.status(400).json({ error: `FTP connection failed: ${e.message}` });
  } finally {
    ftpTest.close();
  }

  // Test DB export via phpMyAdmin — required, fail hard
  try {
    await phpMyAdminVerify(dbCfg);
  } catch (e) {
    return res.status(400).json({ error: `phpMyAdmin export check failed: ${e.message}` });
  }

  const client = {
    id: Date.now().toString(),
    name,
    domain: domain || '',
    plan: plan || 'Basic',
    schedule: schedule || '02:00',
    status: 'ok',
    backups: [],
    lastBackup: null,
    ftp: ftpCfg,
    db: dbCfg,
    createdAt: new Date().toISOString(),
  };

  log(client.id, 'info', `✅ FTP + phpMyAdmin export verified for ${name}`);
  clients.push(client);
  saveClients(clients);
  scheduleClient(client);
  res.json({ success: true, client: maskClient(client) });
});

app.put('/api/clients/:id', (req, res) => {
  const idx = clients.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const incoming = req.body;
  // Don't overwrite passwords with masked placeholders
  if (incoming.ftp?.password === '****') incoming.ftp.password = clients[idx].ftp?.password || '';
  if (incoming.db?.password === '****') incoming.db.password = clients[idx].db?.password || '';
  if (incoming.webArchive?.ssh?.password === '****')
    incoming.webArchive.ssh.password = clients[idx].webArchive?.ssh?.password || '';
  clients[idx] = { ...clients[idx], ...incoming, id: req.params.id };
  saveClients(clients);
  scheduleClient(clients[idx]);
  res.json({ success: true });
});

app.delete('/api/clients/:id', (req, res) => {
  if (cronJobs[req.params.id]) cronJobs[req.params.id].stop();
  clients = clients.filter(c => c.id !== req.params.id);
  saveClients(clients);
  res.json({ success: true });
});

app.post('/api/clients/:id/backup', (req, res) => {
  res.json({ success: true, message: 'Backup started' });
  runClientBackup(req.params.id, 'manual');
});

app.post('/api/clients/:id/backup/pause', (req, res) => {
  const id = String(req.params.id);
  const ctl = getBackupControl(id);
  if (!ctl) return res.json({ success: false, error: 'No running backup for this client' });
  ctl.paused = !ctl.paused;
  const msg = ctl.paused ? 'Backup paused' : 'Backup resumed';
  setProgress(id, { status: 'running', stage: ctl.paused ? 'paused' : 'resuming', message: msg + '…' });
  log(id, 'info', ctl.paused ? '⏸️ Paused by user' : '▶️ Resumed by user');
  res.json({ success: true, paused: ctl.paused });
});

app.post('/api/clients/:id/backup/stop', (req, res) => {
  const id = String(req.params.id);
  const ctl = getBackupControl(id);
  if (!ctl) return res.json({ success: false, error: 'No running backup for this client' });
  ctl.cancel = true;
  ctl.paused = false;
  setProgress(id, { status: 'running', stage: 'cancel', message: 'Stopping backup…' });
  log(id, 'warn', '⏹️ Stop requested by user');
  res.json({ success: true });
});

app.get('/api/clients/:id/backups', (req, res) => {
  const c = clients.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c.backups || []);
});

app.delete('/api/clients/:id/backups/:bkId', (req, res) => {
  const c = clients.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const bk = (c.backups || []).find(b => b.id === req.params.bkId);
  if (bk?.localPath && fs.existsSync(bk.localPath)) fs.unlinkSync(bk.localPath);
  c.backups = (c.backups || []).filter(b => b.id !== req.params.bkId);
  saveClients(clients);
  res.json({ success: true });
});

app.get('/api/clients/:id/backups/:bkId/download', (req, res) => {
  const c = clients.find(x => x.id === req.params.id);
  const bk = (c?.backups || []).find(b => b.id === req.params.bkId);
  if (!bk?.localPath || !fs.existsSync(bk.localPath))
    return res.status(404).json({ error: 'File not found locally' });
  res.download(bk.localPath);
});

app.get('/api/log', (req, res) => {
  const { clientId } = req.query;
  res.json(clientId ? activityLog.filter(e => e.clientId === clientId) : activityLog);
});

// Test FTP connection
app.post('/api/test-ftp', async (req, res) => {
  const ftpCfg = normalizeFtpInput(req.body);
  if (!ftpCfg.host) return res.json({ success: false, error: 'ftp.host required' });
  if (!ftpCfg.user) return res.json({ success: false, error: 'ftp.user required' });
  if (!ftpCfg.password) return res.json({ success: false, error: 'ftp.password required' });

  const testClient = new ftp.Client(30000);
  try {
    await testClient.access({
      host: ftpCfg.host,
      port: Number(ftpCfg.port || 21),
      user: ftpCfg.user,
      password: ftpCfg.password,
      secure: ftpCfg.tls === true,
      secureOptions: { rejectUnauthorized: false },
    });
    const list = await testClient.list(ftpCfg.remotePath || '/');
    const backupFiles = list.filter(f => f.type === ftp.FileType.File && /\.(tar\.gz|tgz|tar|zip|sql\.gz|sql|gz)$/i.test(f.name));
    res.json({ success: true, files: list.length, backupFiles: backupFiles.length, names: backupFiles.map(f => f.name).slice(0, 10) });
  } catch (e) {
    res.json({ success: false, error: e.message });
  } finally {
    testClient.close();
  }
});

// Test MySQL connection
app.post('/api/test-mysql', async (req, res) => {
  const cfg = normalizeMysqlInput(req.body);
  if (!cfg.user) return res.json({ success: false, error: 'user required' });
  if (!cfg.password) return res.json({ success: false, error: 'password required' });
  if (!cfg.database) return res.json({ success: false, error: 'database required' });
  if (!cfg.pmaUrl) return res.json({ success: false, error: 'phpMyAdmin URL required' });

  try {
    await phpMyAdminVerify(cfg);
    res.json({ success: true, databases: [cfg.database] });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Test SSH archive mode for web files
app.post('/api/test-web-archive', async (req, res) => {
  const { ssh, webRoot } = req.body || {};
  try {
    const { fileName, size } = await createRemoteWebArchive(ssh, webRoot || 'public_html', `cwp_web_test_${Date.now()}.tar.gz`);
    await removeRemoteFile(ssh, fileName).catch(() => {});
    res.json({ success: true, fileName, size });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({
    total: clients.length,
    healthy: clients.filter(c => c.status === 'ok').length,
    warning: clients.filter(c => c.status === 'warn').length,
    error: clients.filter(c => c.status === 'error').length,
    totalBackups: clients.reduce((a, c) => a + (c.backups?.length || 0), 0),
  });
});

app.listen(4000, () => console.log('🚀 CWP Backup server on :4000'));
