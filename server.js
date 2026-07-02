"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  });
}

loadDotEnv();

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const RECOVERY_OUTBOX_FILE = path.join(DATA_DIR, "recovery-outbox.json");
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY || "";
const ODDS_REGIONS = process.env.ODDS_REGIONS || "us";
const ODDS_MARKETS = process.env.ODDS_MARKETS || "h2h";
const SPORT_KEYS = (
  process.env.SPORT_KEYS ||
  "baseball_mlb,soccer_fifa_world_cup"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || (ODDS_API_KEY ? 10800000 : 1000));
const LIVE_TICK_INTERVAL_MS = Number(process.env.LIVE_TICK_INTERVAL_MS || 1000);
const SCORE_POLL_INTERVAL_MS = Number(process.env.SCORE_POLL_INTERVAL_MS || 300000);
const EVENT_CACHE_TTL_MS = Number(process.env.EVENT_CACHE_TTL_HOURS || 36) * 60 * 60 * 1000;
const SESSION_TTL_HOURS = Math.max(Number(process.env.SESSION_TTL_HOURS || 720), 720);
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const ALLOW_SIGNUPS = process.env.ALLOW_SIGNUPS !== "false";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/g, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_KV_TABLE =
  String(process.env.SUPABASE_KV_TABLE || "pickpro_kv").replace(/[^a-zA-Z0-9_]/g, "") || "pickpro_kv";
const HAS_SUPABASE_STORE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const clients = new Set();
const eventCache = new Map();
const sessions = new Map();
const authAttempts = new Map();
const recoveryCodes = new Map();

let users = [];
let scoreRefreshInFlight = false;

let feedState = {
  events: [],
  feedMode: ODDS_API_KEY ? "live" : "demo",
  provider: ODDS_API_KEY ? "The Odds API" : "Demo local",
  providerErrors: [],
  lastRefreshAt: null,
  nextRefreshAt: null,
  refreshCount: 0,
  quota: null
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function securityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extra
  };
}

async function ensureDataStore() {
  if (HAS_SUPABASE_STORE) {
    const remoteUsers = await readRemoteValue("users", null);
    if (Array.isArray(remoteUsers)) {
      users = remoteUsers.map(normalizeStoredUser);
    } else {
      users = await readLocalUsers();
      await saveUsers();
    }
    await loadSessions();
    return;
  }

  users = await readLocalUsers();
  await saveUsers();
  await loadSessions();
}

async function readLocalUsers() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const storedUsers = JSON.parse(await fsp.readFile(USERS_FILE, "utf8"));
    return Array.isArray(storedUsers) ? storedUsers.map(normalizeStoredUser) : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function saveUsers() {
  if (HAS_SUPABASE_STORE) {
    await writeRemoteValue("users", users);
    return;
  }

  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

function sessionKey(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeStoredSession(session) {
  const createdAt = Number(session?.createdAt || Date.now());
  const expiresAt = Number(session?.expiresAt || 0);
  return {
    userId: String(session?.userId || ""),
    username: String(session?.username || ""),
    csrfToken: String(session?.csrfToken || ""),
    createdAt,
    expiresAt
  };
}

async function loadSessions() {
  sessions.clear();
  const stored = HAS_SUPABASE_STORE
    ? await readRemoteValue("sessions", {})
    : await readLocalSessions();

  Object.entries(stored && typeof stored === "object" ? stored : {}).forEach(([hash, session]) => {
    const normalized = normalizeStoredSession(session);
    if (/^[a-f0-9]{64}$/i.test(hash) && normalized.userId && normalized.csrfToken && normalized.expiresAt > Date.now()) {
      sessions.set(hash, normalized);
    }
  });
  await saveSessions();
}

async function readLocalSessions() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await fsp.readFile(SESSIONS_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

async function saveSessions() {
  cleanExpiredSessions();
  const stored = Object.fromEntries(sessions.entries());
  if (HAS_SUPABASE_STORE) {
    await writeRemoteValue("sessions", stored);
    return;
  }

  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(SESSIONS_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
}

async function appendRecoveryOutbox(entry) {
  if (HAS_SUPABASE_STORE) {
    const outbox = await readRemoteValue("recovery_outbox", []);
    const nextOutbox = Array.isArray(outbox) ? outbox : [];
    nextOutbox.unshift(entry);
    await writeRemoteValue("recovery_outbox", nextOutbox.slice(0, 50));
    return;
  }

  await fsp.mkdir(DATA_DIR, { recursive: true });
  let outbox = [];
  try {
    outbox = JSON.parse(await fsp.readFile(RECOVERY_OUTBOX_FILE, "utf8"));
    if (!Array.isArray(outbox)) outbox = [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  outbox.unshift(entry);
  await fsp.writeFile(RECOVERY_OUTBOX_FILE, JSON.stringify(outbox.slice(0, 50), null, 2), { mode: 0o600 });
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

function supabaseKvUrl(query = "") {
  return `${SUPABASE_URL}/rest/v1/${SUPABASE_KV_TABLE}${query}`;
}

async function readRemoteValue(key, fallbackValue) {
  const query = `?key=eq.${encodeURIComponent(key)}&select=value`;
  const response = await fetch(supabaseKvUrl(query), {
    headers: supabaseHeaders({ accept: "application/json" })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`No se pudo leer Supabase (${response.status}): ${detail}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows[0] ? rows[0].value : fallbackValue;
}

async function writeRemoteValue(key, value) {
  const response = await fetch(supabaseKvUrl("?on_conflict=key"), {
    method: "POST",
    headers: supabaseHeaders({
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    }),
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`No se pudo guardar en Supabase (${response.status}): ${detail}`);
  }
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeHandle(handle) {
  return String(handle || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function normalizeStoredUser(user) {
  const legacyLogin = classifyLoginId(user.username);
  const email = normalizeUsername(user.email || (legacyLogin.type === "email" ? legacyLogin.value : ""));
  const phone = normalizePhone(user.phone || (legacyLogin.type === "phone" ? legacyLogin.value : ""));
  const handle = normalizeHandle(user.handle || (legacyLogin.type === "unknown" ? user.username : ""));

  return {
    ...user,
    email,
    phone,
    handle: handle || `user_${String(user.id || crypto.randomUUID()).slice(0, 8)}`,
    firstNames: user.firstNames || user.displayName || "",
    lastNames: user.lastNames || "",
    username: user.username || email || phone || handle,
    settings: {
      oddsFormat: user.settings?.oddsFormat === "american" ? "american" : "decimal",
      theme: "dark",
      bookmaker: String(user.settings?.bookmaker || "best").trim() || "best"
    },
    providers: Array.isArray(user.providers) ? user.providers : ["password"]
  };
}

function validatePassword(password) {
  const value = String(password || "");
  return value.length >= 10 && /[a-zA-Z]/.test(value) && /\d/.test(value);
}

function classifyLoginId(value) {
  const normalized = normalizeUsername(value);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  const phoneDigits = normalized.replace(/[^\d+]/g, "");
  const isPhone = /^\+?\d{8,15}$/.test(phoneDigits);
  if (isEmail) return { ok: true, type: "email", value: normalized };
  if (isPhone) return { ok: true, type: "phone", value: phoneDigits };
  return { ok: false, type: "unknown", value: normalized };
}

function findUserByLogin(value) {
  const login = classifyLoginId(value);
  const handle = normalizeHandle(value);
  return users.find((user) => {
    if (login.type === "email" && user.email === login.value) return true;
    if (login.type === "phone" && user.phone === login.value) return true;
    return handle && user.handle === handle;
  });
}

function userPublicProfile(user) {
  return {
    id: user.id,
    firstNames: user.firstNames,
    lastNames: user.lastNames,
    handle: user.handle,
    email: user.email,
    phone: user.phone,
    username: user.handle || user.email || user.phone,
    password: user.passwordHash ? "********" : "No configurada",
    providers: user.providers,
    settings: user.settings
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const params = { N: 16384, r: 8, p: 1 };
  const hash = crypto.scryptSync(String(password), salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, n, r, p, saltText, hashText] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;

  const expected = Buffer.from(hashText, "base64url");
  const actual = crypto.scryptSync(String(password), Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(request) {
  const result = {};
  const header = request.headers.cookie || "";
  header.split(";").forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return;
    result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.join("="));
  });
  return result;
}

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `pickpro_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie() {
  return sessionCookie("", 0);
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [hash, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(hash);
  }
}

function getSession(request) {
  cleanExpiredSessions();
  const token = parseCookies(request).pickpro_session;
  if (!token) return null;
  const tokenHash = sessionKey(token);
  const session = sessions.get(tokenHash);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    return null;
  }
  return { token, tokenHash, ...session };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(24).toString("base64url");
  sessions.set(sessionKey(token), {
    userId: user.id,
    username: user.username,
    csrfToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return { token, csrfToken };
}

function publicUser(session) {
  const user = users.find((item) => item.id === session.userId);
  return user ? userPublicProfile(user) : { id: session.userId, username: session.username };
}

function requestIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "local").split(",")[0].trim();
}

function checkRateLimit(request, key, limit, windowMs) {
  const bucketKey = `${key}:${requestIp(request)}`;
  const now = Date.now();
  const bucket = authAttempts.get(bucketKey) || { count: 0, resetAt: now + windowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  authAttempts.set(bucketKey, bucket);
  return bucket.count <= limit;
}

async function readJsonBody(request, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error("El cuerpo de la solicitud es demasiado grande."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON invalido."));
      }
    });
    request.on("error", reject);
  });
}

async function readFormBody(request, maxBytes = 8192) {
  const body = await new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error("El cuerpo de la solicitud es demasiado grande."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
  return Object.fromEntries(new URLSearchParams(body));
}

function sendRedirect(response, location) {
  response.writeHead(302, securityHeaders({ location, "cache-control": "no-store" }));
  response.end();
}

function sendAuthRequired(response) {
  sendJson(response, 401, { error: "Sesion requerida" });
}

function sendLoginResult(response, user, csrfToken, token) {
  response.writeHead(
    200,
    securityHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000))
    })
  );
  response.end(JSON.stringify({ authenticated: true, user: userPublicProfile(user), csrfToken }));
}

function requireAuth(request, response) {
  const session = getSession(request);
  if (!session) {
    sendAuthRequired(response);
    return null;
  }
  return session;
}

function requireCsrf(request, response, session) {
  const token = request.headers["x-csrf-token"];
  if (!token || token !== session.csrfToken) {
    sendJson(response, 403, { error: "Token de seguridad invalido" });
    return false;
  }
  return true;
}

async function registerUser(request, response) {
  if (!ALLOW_SIGNUPS) {
    sendJson(response, 403, { error: "El registro esta cerrado en este servidor." });
    return;
  }
  if (!checkRateLimit(request, "register", 8, 15 * 60 * 1000)) {
    sendJson(response, 429, { error: "Demasiados intentos. Prueba de nuevo mas tarde." });
    return;
  }

  const body = await readJsonBody(request);
  const email = normalizeUsername(body.email);
  const phone = normalizePhone(body.phone);
  const handle = normalizeHandle(body.handle);
  const firstNames = String(body.firstNames || "").trim().slice(0, 80);
  const lastNames = String(body.lastNames || "").trim().slice(0, 80);
  const password = String(body.password || "");
  const primaryLogin = email || phone || handle;

  if (!firstNames || !lastNames) {
    sendJson(response, 400, { error: "Escribe nombres y apellidos." });
    return;
  }
  if (!handle || handle.length < 3) {
    sendJson(response, 400, { error: "Crea un usuario de al menos 3 caracteres. Usa letras, numeros o guion bajo." });
    return;
  }
  if (!email && !phone) {
    sendJson(response, 400, { error: "Registra un correo electronico o un numero telefonico." });
    return;
  }
  if (email && !classifyLoginId(email).ok) {
    sendJson(response, 400, { error: "Correo electronico invalido." });
    return;
  }
  if (phone && classifyLoginId(phone).type !== "phone") {
    sendJson(response, 400, { error: "Numero telefonico invalido. Usa 8 a 15 digitos." });
    return;
  }
  if (!validatePassword(password)) {
    sendJson(response, 400, { error: "La contrasena debe tener al menos 10 caracteres, letras y numeros." });
    return;
  }
  if (email && users.some((user) => user.email === email)) {
    sendJson(response, 409, { error: "Ese correo ya esta registrado." });
    return;
  }
  if (phone && users.some((user) => user.phone === phone)) {
    sendJson(response, 409, { error: "Ese numero ya esta registrado en otra cuenta." });
    return;
  }
  if (users.some((user) => user.handle === handle)) {
    sendJson(response, 409, { error: "Ese nombre de usuario ya esta ocupado." });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    username: primaryLogin,
    email,
    phone,
    handle,
    contactType: email ? "email" : "phone",
    firstNames,
    lastNames,
    displayName: `${firstNames} ${lastNames}`.trim(),
    passwordHash: hashPassword(password),
    providers: ["password"],
    settings: { oddsFormat: "decimal", theme: "dark", bookmaker: "best" },
    createdAt: nowIso()
  };
  users.push(user);
  await saveUsers();
  const session = createSession(user);
  await saveSessions();
  sendLoginResult(response, user, session.csrfToken, session.token);
}

async function loginUser(request, response) {
  if (!checkRateLimit(request, "login", 10, 10 * 60 * 1000)) {
    sendJson(response, 429, { error: "Demasiados intentos. Prueba de nuevo mas tarde." });
    return;
  }

  const body = await readJsonBody(request);
  const password = String(body.password || "");
  const user = findUserByLogin(body.username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    sendJson(response, 401, { error: "Correo, numero, usuario o contrasena incorrectos." });
    return;
  }

  const session = createSession(user);
  await saveSessions();
  sendLoginResult(response, user, session.csrfToken, session.token);
}

async function startRecovery(request, response) {
  if (!checkRateLimit(request, "recovery", 6, 15 * 60 * 1000)) {
    sendJson(response, 429, { error: "Demasiados intentos. Prueba mas tarde." });
    return;
  }

  const body = await readJsonBody(request);
  const account = String(body.account || "").trim();
  const user = findUserByLogin(account);
  if (!user) {
    sendJson(response, 200, { ok: true, message: "Si existe una cuenta, enviaremos un codigo de verificacion." });
    return;
  }

  const destination = user.email || user.phone;
  if (!destination) {
    sendJson(response, 400, { error: "La cuenta no tiene correo ni telefono de recuperacion." });
    return;
  }

  const code = String(crypto.randomInt(100000, 999999));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  recoveryCodes.set(user.id, {
    codeHash,
    attempts: 0,
    expiresAt: Date.now() + 10 * 60 * 1000
  });
  await appendRecoveryOutbox({
    to: destination,
    account: user.handle || user.email || user.phone,
    code,
    createdAt: nowIso(),
    note: "En produccion este codigo debe enviarse por SMS/correo con un proveedor como Twilio, SendGrid o SES."
  });

  sendJson(response, 200, {
    ok: true,
    message: "Codigo de verificacion generado. En esta version local revisa data/recovery-outbox.json."
  });
}

async function confirmRecovery(request, response) {
  if (!checkRateLimit(request, "recovery-confirm", 10, 15 * 60 * 1000)) {
    sendJson(response, 429, { error: "Demasiados intentos. Prueba mas tarde." });
    return;
  }

  const body = await readJsonBody(request);
  const user = findUserByLogin(body.account);
  const record = user ? recoveryCodes.get(user.id) : null;
  const codeHash = crypto.createHash("sha256").update(String(body.code || "")).digest("hex");

  if (!user || !record || record.expiresAt < Date.now()) {
    sendJson(response, 400, { error: "Codigo invalido o expirado." });
    return;
  }
  record.attempts += 1;
  if (record.attempts > 5 || record.codeHash !== codeHash) {
    sendJson(response, 400, { error: "Codigo invalido o expirado." });
    return;
  }
  if (!validatePassword(body.newPassword)) {
    sendJson(response, 400, { error: "La nueva contrasena debe tener al menos 10 caracteres, letras y numeros." });
    return;
  }

  user.passwordHash = hashPassword(body.newPassword);
  if (!user.providers.includes("password")) user.providers.push("password");
  user.passwordUpdatedAt = nowIso();
  recoveryCodes.delete(user.id);
  await saveUsers();
  sendJson(response, 200, { ok: true, message: "Contrasena actualizada. Ya puedes iniciar sesion." });
}

async function updateSettings(request, response, session) {
  const body = await readJsonBody(request);
  const user = users.find((item) => item.id === session.userId);
  if (!user) {
    sendAuthRequired(response);
    return;
  }
  user.settings = {
    oddsFormat: body.oddsFormat === "american" ? "american" : "decimal",
    theme: "dark",
    bookmaker: String(body.bookmaker || user.settings?.bookmaker || "best").trim().slice(0, 80) || "best"
  };
  await saveUsers();
  sendJson(response, 200, { ok: true, settings: user.settings });
}

async function updateProfile(request, response, session) {
  const body = await readJsonBody(request, 8192);
  const user = users.find((item) => item.id === session.userId);
  if (!user) {
    sendAuthRequired(response);
    return;
  }

  const handle = normalizeHandle(body.handle);
  if (!handle || handle.length < 3 || handle.length > 30) {
    sendJson(response, 400, { error: "El nombre de usuario debe tener entre 3 y 30 caracteres. Usa letras, numeros o guion bajo." });
    return;
  }
  if (users.some((item) => item.id !== user.id && item.handle === handle)) {
    sendJson(response, 409, { error: "Ese nombre de usuario ya esta en uso. Elige otro para evitar confusiones." });
    return;
  }

  user.handle = handle;
  user.username = user.email || user.phone || handle;
  session.username = handle;
  await saveUsers();
  await saveSessions();
  sendJson(response, 200, { ok: true, user: userPublicProfile(user) });
}

const DEMO_EVENTS = [
  {
    id: "demo-lmx-america-guadalajara",
    sport: "Futbol",
    sportKey: "soccer_mexico_ligamx",
    league: "Liga MX",
    homeTeam: "America",
    awayTeam: "Guadalajara",
    venue: "Ciudad de Mexico",
    commenceOffsetHours: 0.2,
    score: { home: 2, away: 1 },
    markets: {
      h2h: [
        { book: "Draftea", home: 1.85, draw: 3.40, away: 4.20, updatedMins: 2 },
        { book: "Playdoit", home: 1.88, draw: 3.35, away: 4.12, updatedMins: 4 },
        { book: "Consenso", home: 1.86, draw: 3.38, away: 4.18, updatedMins: 1 }
      ],
      totals: [
        { book: "Draftea", line: 2.5, over: 1.91, under: 1.89 },
        { book: "Playdoit", line: 2.5, over: 1.94, under: 1.86 }
      ]
    },
    stats: {
      homeForm: 0.72,
      awayForm: 0.55,
      homeAttack: 0.74,
      awayAttack: 0.59,
      homeDefense: 0.65,
      awayDefense: 0.62,
      homeInjuryImpact: 0.04,
      awayInjuryImpact: 0.08,
      restEdge: 0.05,
      marketDepth: 0.82,
      volatility: 0.17
    }
  },
  {
    id: "demo-lmx-tigres-cruzazul",
    sport: "Futbol",
    sportKey: "soccer_mexico_ligamx",
    league: "Liga MX",
    homeTeam: "Tigres",
    awayTeam: "Cruz Azul",
    venue: "San Nicolas",
    commenceOffsetHours: 28,
    markets: {
      h2h: [
        { book: "Draftea", home: 1.92, draw: 3.36, away: 4.05, updatedMins: 7 },
        { book: "Playdoit", home: 1.95, draw: 3.32, away: 3.96, updatedMins: 5 },
        { book: "Consenso", home: 1.90, draw: 3.40, away: 4.10, updatedMins: 2 }
      ],
      totals: [
        { book: "Draftea", line: 2.5, over: 2.02, under: 1.78 },
        { book: "Playdoit", line: 2.5, over: 2.00, under: 1.80 }
      ]
    },
    stats: {
      homeForm: 0.64,
      awayForm: 0.58,
      homeAttack: 0.69,
      awayAttack: 0.59,
      homeDefense: 0.67,
      awayDefense: 0.61,
      homeInjuryImpact: 0.06,
      awayInjuryImpact: 0.07,
      restEdge: 0.03,
      marketDepth: 0.76,
      volatility: 0.14
    }
  },
  {
    id: "demo-worldcup-mexico-uruguay",
    sport: "Futbol",
    sportKey: "soccer_fifa_world_cup",
    league: "Copa Mundial FIFA",
    homeTeam: "Mexico",
    awayTeam: "Uruguay",
    venue: "Mundial 2026",
    commenceOffsetHours: 4,
    markets: {
      h2h: [
        { book: "Draftea", home: 2.35, draw: 3.05, away: 3.12, updatedMins: 2 },
        { book: "Playdoit", home: 2.38, draw: 3.00, away: 3.08, updatedMins: 4 },
        { book: "Consenso", home: 2.36, draw: 3.04, away: 3.10, updatedMins: 1 }
      ],
      totals: [
        { book: "Draftea", line: 2.5, over: 1.98, under: 1.82 },
        { book: "Playdoit", line: 2.5, over: 2.00, under: 1.80 }
      ]
    },
    stats: {
      homeForm: 0.61,
      awayForm: 0.64,
      homeAttack: 0.66,
      awayAttack: 0.68,
      homeDefense: 0.63,
      awayDefense: 0.66,
      homeInjuryImpact: 0.04,
      awayInjuryImpact: 0.05,
      restEdge: 0.01,
      marketDepth: 0.72,
      volatility: 0.16
    }
  },
  {
    id: "demo-worldcup-brazil-spain",
    sport: "Futbol",
    sportKey: "soccer_fifa_world_cup",
    league: "Copa Mundial FIFA",
    homeTeam: "Brasil",
    awayTeam: "Espana",
    venue: "Mundial 2026",
    commenceOffsetHours: 29,
    markets: {
      h2h: [
        { book: "Draftea", home: 2.18, draw: 3.28, away: 3.28, updatedMins: 3 },
        { book: "Playdoit", home: 2.16, draw: 3.32, away: 3.30, updatedMins: 5 },
        { book: "Consenso", home: 2.19, draw: 3.30, away: 3.24, updatedMins: 2 }
      ],
      totals: [
        { book: "Draftea", line: 2.5, over: 1.87, under: 1.93 },
        { book: "Playdoit", line: 2.5, over: 1.90, under: 1.90 }
      ]
    },
    stats: {
      homeForm: 0.69,
      awayForm: 0.67,
      homeAttack: 0.74,
      awayAttack: 0.72,
      homeDefense: 0.65,
      awayDefense: 0.68,
      homeInjuryImpact: 0.05,
      awayInjuryImpact: 0.04,
      restEdge: 0.00,
      marketDepth: 0.75,
      volatility: 0.18
    }
  },
  {
    id: "demo-mlb-dodgers-giants",
    sport: "Beisbol",
    sportKey: "baseball_mlb",
    league: "MLB",
    homeTeam: "Dodgers",
    awayTeam: "Giants",
    venue: "Los Angeles",
    commenceOffsetHours: 9,
    markets: {
      h2h: [
        { book: "Draftea", home: 1.67, away: 2.22, updatedMins: 3 },
        { book: "Playdoit", home: 1.69, away: 2.18, updatedMins: 6 },
        { book: "Consenso", home: 1.66, away: 2.25, updatedMins: 2 }
      ],
      totals: [
        { book: "Draftea", line: 8.5, over: 1.88, under: 1.92 },
        { book: "Playdoit", line: 8.5, over: 1.90, under: 1.90 }
      ]
    },
    stats: {
      homeForm: 0.71,
      awayForm: 0.55,
      homeAttack: 0.75,
      awayAttack: 0.58,
      homeDefense: 0.69,
      awayDefense: 0.57,
      homeInjuryImpact: 0.03,
      awayInjuryImpact: 0.10,
      restEdge: 0.02,
      marketDepth: 0.79,
      volatility: 0.12
    }
  },
  {
    id: "demo-nba-warriors-heat",
    sport: "Basquetbol",
    sportKey: "basketball_nba",
    league: "NBA",
    homeTeam: "Heat",
    awayTeam: "Warriors",
    venue: "Miami",
    commenceOffsetHours: 34,
    markets: {
      h2h: [
        { book: "Draftea", home: 2.30, away: 1.65, updatedMins: 8 },
        { book: "Playdoit", home: 2.28, away: 1.67, updatedMins: 4 },
        { book: "Consenso", home: 2.33, away: 1.64, updatedMins: 3 }
      ],
      spreads: [
        { book: "Draftea", homeLine: -2.5, home: 1.91, awayLine: 2.5, away: 1.89 },
        { book: "Playdoit", homeLine: -2.5, home: 1.90, awayLine: 2.5, away: 1.90 }
      ]
    },
    stats: {
      homeForm: 0.53,
      awayForm: 0.63,
      homeAttack: 0.62,
      awayAttack: 0.71,
      homeDefense: 0.56,
      awayDefense: 0.60,
      homeInjuryImpact: 0.09,
      awayInjuryImpact: 0.06,
      restEdge: 0.01,
      marketDepth: 0.86,
      volatility: 0.22
    }
  },
  {
    id: "demo-nfl-chiefs-bills",
    sport: "Futbol Americano",
    sportKey: "americanfootball_nfl",
    league: "NFL",
    homeTeam: "Chiefs",
    awayTeam: "Bills",
    venue: "Kansas City",
    commenceOffsetHours: 62,
    markets: {
      h2h: [
        { book: "Draftea", home: 1.78, away: 2.08, updatedMins: 12 },
        { book: "Playdoit", home: 1.80, away: 2.05, updatedMins: 11 },
        { book: "Consenso", home: 1.77, away: 2.10, updatedMins: 9 }
      ],
      spreads: [
        { book: "Draftea", homeLine: -3.0, home: 1.95, awayLine: 3.0, away: 1.85 },
        { book: "Playdoit", homeLine: -2.5, home: 1.88, awayLine: 2.5, away: 1.92 }
      ]
    },
    stats: {
      homeForm: 0.66,
      awayForm: 0.62,
      homeAttack: 0.74,
      awayAttack: 0.72,
      homeDefense: 0.63,
      awayDefense: 0.64,
      homeInjuryImpact: 0.06,
      awayInjuryImpact: 0.05,
      restEdge: 0.04,
      marketDepth: 0.88,
      volatility: 0.20
    }
  },
  {
    id: "demo-tennis-sabalenka-swiatek",
    sport: "Tenis",
    sportKey: "tennis_wta",
    league: "WTA",
    homeTeam: "Sabalenka",
    awayTeam: "Swiatek",
    venue: "Cancha central",
    commenceOffsetHours: 17,
    markets: {
      h2h: [
        { book: "Draftea", home: 2.15, away: 1.73, updatedMins: 1 },
        { book: "Playdoit", home: 2.12, away: 1.75, updatedMins: 2 },
        { book: "Consenso", home: 2.18, away: 1.71, updatedMins: 1 }
      ]
    },
    stats: {
      homeForm: 0.63,
      awayForm: 0.69,
      homeAttack: 0.71,
      awayAttack: 0.68,
      homeDefense: 0.58,
      awayDefense: 0.65,
      homeInjuryImpact: 0.04,
      awayInjuryImpact: 0.03,
      restEdge: -0.02,
      marketDepth: 0.74,
      volatility: 0.16
    }
  },
  {
    id: "demo-wnba-aces-liberty",
    sport: "WNBA",
    sportKey: "basketball_wnba",
    league: "WNBA",
    homeTeam: "Aces",
    awayTeam: "Liberty",
    venue: "Las Vegas",
    commenceOffsetHours: 22,
    markets: {
      h2h: [
        { book: "Draftea", home: 1.82, away: 2.04, updatedMins: 2 },
        { book: "Playdoit", home: 1.84, away: 2.01, updatedMins: 3 }
      ]
    },
    stats: {
      homeForm: 0.62,
      awayForm: 0.59,
      homeAttack: 0.68,
      awayAttack: 0.64,
      homeDefense: 0.61,
      awayDefense: 0.60,
      homeInjuryImpact: 0.05,
      awayInjuryImpact: 0.06,
      restEdge: 0.02,
      marketDepth: 0.72,
      volatility: 0.18
    }
  },
  {
    id: "demo-nhl-rangers-bruins",
    sport: "Hockey",
    sportKey: "icehockey_nhl",
    league: "NHL",
    homeTeam: "Rangers",
    awayTeam: "Bruins",
    venue: "New York",
    commenceOffsetHours: 12,
    markets: {
      h2h: [
        { book: "Draftea", home: 1.96, away: 1.90, updatedMins: 2 },
        { book: "Playdoit", home: 1.98, away: 1.88, updatedMins: 4 }
      ]
    },
    stats: {
      homeForm: 0.57,
      awayForm: 0.55,
      homeAttack: 0.62,
      awayAttack: 0.61,
      homeDefense: 0.63,
      awayDefense: 0.59,
      homeInjuryImpact: 0.04,
      awayInjuryImpact: 0.05,
      restEdge: 0.03,
      marketDepth: 0.70,
      volatility: 0.20
    }
  },
  {
    id: "demo-mma-moreno-pantoja",
    sport: "MMA",
    sportKey: "mma_mixed_martial_arts",
    league: "UFC",
    homeTeam: "Moreno",
    awayTeam: "Pantoja",
    venue: "Octagono",
    commenceOffsetHours: 46,
    markets: {
      h2h: [
        { book: "Draftea", home: 2.12, away: 1.74, updatedMins: 5 },
        { book: "Playdoit", home: 2.08, away: 1.77, updatedMins: 6 }
      ]
    },
    stats: {
      homeForm: 0.60,
      awayForm: 0.64,
      homeAttack: 0.67,
      awayAttack: 0.70,
      homeDefense: 0.58,
      awayDefense: 0.63,
      homeInjuryImpact: 0.03,
      awayInjuryImpact: 0.04,
      restEdge: 0.00,
      marketDepth: 0.68,
      volatility: 0.24
    }
  },
  {
    id: "demo-box-canelo-benavidez",
    sport: "Box",
    sportKey: "boxing_boxing",
    league: "Box",
    homeTeam: "Canelo",
    awayTeam: "Benavidez",
    venue: "Las Vegas",
    commenceOffsetHours: 72,
    markets: {
      h2h: [
        { book: "Draftea", home: 1.72, away: 2.18, updatedMins: 4 },
        { book: "Playdoit", home: 1.75, away: 2.12, updatedMins: 7 }
      ]
    },
    stats: {
      homeForm: 0.70,
      awayForm: 0.66,
      homeAttack: 0.73,
      awayAttack: 0.71,
      homeDefense: 0.69,
      awayDefense: 0.63,
      homeInjuryImpact: 0.02,
      awayInjuryImpact: 0.04,
      restEdge: 0.01,
      marketDepth: 0.74,
      volatility: 0.22
    }
  },
  {
    id: "demo-laliga-realbarca",
    sport: "Futbol",
    sportKey: "soccer_spain_la_liga",
    league: "La Liga",
    homeTeam: "Real Madrid",
    awayTeam: "Barcelona",
    venue: "Madrid",
    commenceOffsetHours: 30,
    markets: {
      h2h: [
        { book: "Draftea", home: 2.10, draw: 3.35, away: 3.20, updatedMins: 3 },
        { book: "Playdoit", home: 2.06, draw: 3.40, away: 3.28, updatedMins: 4 }
      ]
    },
    stats: {
      homeForm: 0.67,
      awayForm: 0.64,
      homeAttack: 0.76,
      awayAttack: 0.74,
      homeDefense: 0.65,
      awayDefense: 0.62,
      homeInjuryImpact: 0.05,
      awayInjuryImpact: 0.05,
      restEdge: 0.02,
      marketDepth: 0.78,
      volatility: 0.18
    }
  }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hashString(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function nowIso() {
  return new Date().toISOString();
}

function withTimeOffset(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function liveWindowMsForSport(sportKey = "") {
  if (sportKey.includes("baseball")) return 4.5 * 60 * 60 * 1000;
  if (sportKey.includes("soccer")) return 2.25 * 60 * 60 * 1000;
  if (sportKey.includes("basketball")) return 2.75 * 60 * 60 * 1000;
  if (sportKey.includes("americanfootball")) return 4 * 60 * 60 * 1000;
  if (sportKey.includes("icehockey")) return 2.75 * 60 * 60 * 1000;
  if (sportKey.includes("tennis")) return 5 * 60 * 60 * 1000;
  if (sportKey.includes("mma") || sportKey.includes("boxing")) return 5 * 60 * 60 * 1000;
  return 3 * 60 * 60 * 1000;
}

function eventCacheKey(event) {
  return event.id || `${event.sportKey || ""}-${event.homeTeam || ""}-${event.awayTeam || ""}-${event.commenceTime || ""}`;
}

function runtimeStatusForEvent(event, now = Date.now()) {
  if (event.status === "final") return "final";
  const startMs = new Date(event.commenceTime).getTime();
  if (!Number.isFinite(startMs)) return event.status || "upcoming";
  if (now < startMs) return "upcoming";
  if (now <= startMs + liveWindowMsForSport(event.sportKey)) return "live";
  return "final";
}

function normalizeRuntimeEvent(event, now = Date.now()) {
  const status = runtimeStatusForEvent(event, now);
  let scoreSource = event.scoreSource || "";
  if (status === "live" && !event.score) scoreSource = "En vivo";
  if (status === "final" && !event.score) scoreSource = "Final estimado; esperando marcador oficial";
  return {
    ...event,
    status,
    scoreSource
  };
}

function shouldRetainCachedEvent(event, now = Date.now()) {
  const startMs = new Date(event.commenceTime).getTime();
  if (!Number.isFinite(startMs)) return false;
  return Math.abs(now - startMs) <= EVENT_CACHE_TTL_MS;
}

function normalizeRuntimeEvents(events, now = Date.now()) {
  return events
    .map((event) => normalizeRuntimeEvent(event, now))
    .filter((event) => shouldRetainCachedEvent(event, now) || event.status !== "final")
    .sort((a, b) => {
      const liveDelta = Number(b.status === "live") - Number(a.status === "live");
      if (liveDelta) return liveDelta;
      return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime();
    });
}

function mergeWithEventCache(events) {
  const now = Date.now();
  const merged = [];
  const seen = new Set();

  normalizeRuntimeEvents(events, now).forEach((event) => {
    const key = eventCacheKey(event);
    seen.add(key);
    eventCache.set(key, event);
    merged.push(event);
  });

  for (const [key, cachedEvent] of eventCache.entries()) {
    if (!shouldRetainCachedEvent(cachedEvent, now)) {
      eventCache.delete(key);
      continue;
    }
    if (!seen.has(key)) {
      const event = normalizeRuntimeEvent(cachedEvent, now);
      eventCache.set(key, event);
      merged.push(event);
    }
  }

  return normalizeRuntimeEvents(merged, now);
}

function cachedProviderEvents() {
  return normalizeRuntimeEvents(Array.from(eventCache.values()));
}

function softmax(scores) {
  const maxScore = Math.max(...scores.map((item) => item.score));
  const exps = scores.map((item) => ({ key: item.key, value: Math.exp(item.score - maxScore) }));
  const total = exps.reduce((sum, item) => sum + item.value, 0) || 1;
  return Object.fromEntries(exps.map((item) => [item.key, item.value / total]));
}

function mean(values) {
  const filtered = values.filter((item) => Number.isFinite(item));
  if (!filtered.length) return null;
  return filtered.reduce((sum, item) => sum + item, 0) / filtered.length;
}

function standardDeviation(values) {
  const filtered = values.filter((item) => Number.isFinite(item));
  if (filtered.length < 2) return 0;
  const avg = mean(filtered);
  const variance = filtered.reduce((sum, item) => sum + (item - avg) ** 2, 0) / filtered.length;
  return Math.sqrt(variance);
}

function perturbOdds(odds, seed, index) {
  const wave = Math.sin(Date.now() / 47000 + seed * 0.11 + index) * 0.018;
  const slow = Math.cos(Date.now() / 83000 + seed * 0.07 + index) * 0.011;
  return Math.max(1.1, round(odds * (1 + wave + slow), 2));
}

function buildDemoFeed() {
  const refreshSeed = feedState.refreshCount + 1;
  const configuredSports = new Set(SPORT_KEYS);
  const demoEvents = DEMO_EVENTS.filter((event) => configuredSports.has(event.sportKey));
  const sourceEvents = demoEvents.length ? demoEvents : DEMO_EVENTS;

  return sourceEvents.map((event, eventIndex) => {
    const seed = hashString(event.id) + refreshSeed;
    const markets = JSON.parse(JSON.stringify(event.markets));

    Object.values(markets).forEach((marketRows) => {
      marketRows.forEach((row, rowIndex) => {
        ["home", "draw", "away", "over", "under"].forEach((key, keyIndex) => {
          if (typeof row[key] === "number") {
            row[key] = perturbOdds(row[key], seed + rowIndex, keyIndex);
          }
        });
        row.updatedMins = Math.max(1, Math.round((row.updatedMins || 2) + Math.sin(Date.now() / 60000 + eventIndex) * 2));
      });
    });

    const statWave = Math.sin(Date.now() / 11000 + seed * 0.013) * 0.012;
    const awayWave = Math.cos(Date.now() / 13000 + seed * 0.017) * 0.012;
    const stats = {
      ...event.stats,
      homeForm: clamp(event.stats.homeForm + statWave, 0.25, 0.9),
      awayForm: clamp(event.stats.awayForm + awayWave, 0.25, 0.9),
      homeAttack: clamp(event.stats.homeAttack + statWave * 0.75, 0.25, 0.9),
      awayAttack: clamp(event.stats.awayAttack + awayWave * 0.75, 0.25, 0.9),
      volatility: clamp(event.stats.volatility + Math.abs(statWave - awayWave) * 0.5, 0.05, 0.45)
    };
    const liveWindow = event.commenceOffsetHours <= 1 && event.commenceOffsetHours > -2;
    return {
      ...event,
      stats,
      dataSource: "Demo local",
      isDemo: true,
      status: liveWindow ? "live" : "upcoming",
      commenceTime: withTimeOffset(event.commenceOffsetHours),
      markets
    };
  });
}

function averageMarketProbabilities(event) {
  const rows = event.markets?.h2h || [];
  const hasDraw = rows.some((row) => Number.isFinite(row.draw));
  const keys = hasDraw ? ["home", "draw", "away"] : ["home", "away"];
  const normalizedRows = [];

  rows.forEach((row) => {
    const implied = {};
    keys.forEach((key) => {
      if (Number.isFinite(row[key]) && row[key] > 1) {
        implied[key] = 1 / row[key];
      }
    });

    const total = Object.values(implied).reduce((sum, value) => sum + value, 0);
    if (total > 0) {
      normalizedRows.push(Object.fromEntries(Object.entries(implied).map(([key, value]) => [key, value / total])));
    }
  });

  const probabilities = {};
  keys.forEach((key) => {
    probabilities[key] = mean(normalizedRows.map((row) => row[key])) ?? 1 / keys.length;
  });

  return { probabilities, keys, rows };
}

function bestDecimalOdds(event, keys) {
  const result = {};
  keys.forEach((key) => {
    let best = null;
    (event.markets?.h2h || []).forEach((row) => {
      if (Number.isFinite(row[key]) && (!best || row[key] > best.price)) {
        best = { book: row.book, price: row[key] };
      }
    });
    result[key] = best;
  });
  return result;
}

function buildStatProbabilities(event, keys) {
  const stats = event.stats || {};
  const homeContext =
    (event.sportKey || "").includes("baseball") ? 0.035 : (event.sportKey || "").includes("soccer") ? 0.055 : 0.045;
  const matchupTilt = (hashString(`${event.id}-${event.homeTeam}-${event.awayTeam}-matchup`) % 1000) / 1000 - 0.5;
  const scheduleTilt = (hashString(`${event.commenceTime}-${event.league}`) % 1000) / 1000 - 0.5;
  const homeStrength =
    (stats.homeForm || 0.5) * 1.4 +
    (stats.homeAttack || 0.5) * 1.15 +
    (stats.homeDefense || 0.5) * 0.85 -
    (stats.homeInjuryImpact || 0) * 1.1 +
    (stats.restEdge || 0) * 1.4 +
    homeContext +
    matchupTilt * 0.16 +
    scheduleTilt * 0.06;
  const awayStrength =
    (stats.awayForm || 0.5) * 1.4 +
    (stats.awayAttack || 0.5) * 1.15 +
    (stats.awayDefense || 0.5) * 0.85 -
    (stats.awayInjuryImpact || 0) * 1.1 -
    (stats.restEdge || 0) * 1.4 -
    homeContext * 0.62 -
    matchupTilt * 0.16 -
    scheduleTilt * 0.06;

  const scores = [
    { key: "home", score: homeStrength },
    { key: "away", score: awayStrength }
  ];

  if (keys.includes("draw")) {
    const defensiveBalance = 1 - Math.abs((stats.homeAttack || 0.5) - (stats.awayAttack || 0.5));
    scores.push({ key: "draw", score: 1.4 + defensiveBalance * 0.38 - Math.abs(homeStrength - awayStrength) * 0.42 });
  }

  return softmax(scores);
}

function normalizeProbabilityMap(map, keys) {
  const raw = {};
  keys.forEach((key) => {
    raw[key] = Math.max(0, Number(map?.[key]) || 0);
  });
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  keys.forEach((key) => {
    raw[key] = raw[key] / total;
  });
  return raw;
}

function elapsedMinutes(event) {
  const startMs = new Date(event?.commenceTime).getTime();
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 60000));
}

function buildLiveScoreProbabilities(event, keys) {
  if (event.status !== "live" || !event.score) return null;
  const homeScore = Number(event.score.home);
  const awayScore = Number(event.score.away);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;

  const lead = homeScore - awayScore;
  const minutes = elapsedMinutes(event);
  const isSoccer = (event.sportKey || "").includes("soccer");
  const isBaseball = (event.sportKey || "").includes("baseball");
  const progress = isSoccer ? clamp(minutes / 95, 0.08, 0.96) : isBaseball ? clamp(minutes / 190, 0.08, 0.92) : 0.45;
  const leadPressure = clamp(Math.abs(lead) * (isSoccer ? 0.28 : 0.17) * progress, 0, 0.34);
  const scores = [
    { key: "home", score: 1 + (lead > 0 ? leadPressure : -leadPressure) + (lead === 0 ? 0.03 : 0) },
    { key: "away", score: 1 + (lead < 0 ? leadPressure : -leadPressure) }
  ];

  if (keys.includes("draw")) {
    const drawBase = lead === 0 ? 1.12 + progress * 0.22 : 0.88 - leadPressure * 1.2;
    scores.push({ key: "draw", score: drawBase });
  }

  return softmax(scores.filter((item) => keys.includes(item.key)));
}

function buildTrend(event, winnerKey, probability) {
  const seed = hashString(event.id + winnerKey);
  const points = [];
  for (let index = 0; index < 18; index += 1) {
    const phase = index * 0.72 + seed * 0.003 + Date.now() / 240000;
    const drift = (index - 9) * 0.0025;
    points.push(round(clamp(probability + Math.sin(phase) * 0.018 + drift, 0.08, 0.86), 3));
  }
  return points;
}

function labelForOutcome(event, key) {
  if (key === "home") return event.homeTeam;
  if (key === "away") return event.awayTeam;
  return "Empate";
}

function buildReasons(event, pickKey, modelProbabilities, marketProbabilities) {
  const stats = event.stats || {};
  const pickedTeam = labelForOutcome(event, pickKey);
  const reasons = [];
  const formGap = (stats.homeForm || 0.5) - (stats.awayForm || 0.5);
  const attackGap = (stats.homeAttack || 0.5) - (stats.awayAttack || 0.5);
  const injuryGap = (stats.awayInjuryImpact || 0) - (stats.homeInjuryImpact || 0);
  const marketGap = modelProbabilities[pickKey] - (marketProbabilities[pickKey] || 0);

  if (pickKey === "home" && formGap > 0.04) reasons.push(`${event.homeTeam} llega con mejor forma reciente.`);
  if (pickKey === "away" && formGap < -0.04) reasons.push(`${event.awayTeam} llega con mejor forma reciente.`);
  if (pickKey === "home" && attackGap > 0.05) reasons.push(`Ventaja ofensiva para ${event.homeTeam}.`);
  if (pickKey === "away" && attackGap < -0.05) reasons.push(`Ventaja ofensiva para ${event.awayTeam}.`);
  if (pickKey === "home" && injuryGap > 0.03) reasons.push(`${event.awayTeam} carga mayor impacto por ausencias.`);
  if (pickKey === "away" && injuryGap < -0.03) reasons.push(`${event.homeTeam} carga mayor impacto por ausencias.`);
  if (pickKey === "draw") reasons.push("El mercado y los indicadores internos muestran fuerzas parejas.");
  if (marketGap > 0.025) reasons.push(`El modelo ve mas valor que el consenso en ${pickedTeam}.`);
  if (event.status === "live" && event.score) reasons.push("El marcador en vivo y el tiempo de juego recalibran la probabilidad.");
  if ((stats.volatility || 0) > 0.2) reasons.push("Movimiento de cuota elevado: conviene vigilar cambios antes de tomar decisiones.");
  if (!reasons.length) reasons.push("La ventaja existe, pero el margen frente al mercado es estrecho.");

  return reasons.slice(0, 3);
}

function calculatePrediction(event) {
  const { probabilities: marketProbabilities, keys, rows } = averageMarketProbabilities(event);
  const statProbabilities = buildStatProbabilities(event, keys);
  const liveScoreProbabilities = buildLiveScoreProbabilities(event, keys);
  const bestOdds = bestDecimalOdds(event, keys);
  const marketDepth = clamp(event.stats?.marketDepth ?? rows.length / 5, 0.35, 0.95);
  const volatility = clamp(event.stats?.volatility ?? standardDeviation(rows.flatMap((row) => keys.map((key) => row[key]).filter(Boolean))) / 10, 0.05, 0.45);
  const liveWeight = liveScoreProbabilities ? clamp(0.2 + elapsedMinutes(event) / 420, 0.2, 0.38) : 0;
  const marketWeight = clamp(0.38 + marketDepth * 0.22 - volatility * 0.22 - liveWeight * 0.26, 0.32, 0.62);
  const statWeight = clamp(1 - marketWeight - liveWeight, 0.2, 0.58);
  const modelProbabilities = {};

  keys.forEach((key) => {
    modelProbabilities[key] =
      (marketProbabilities[key] || 0) * marketWeight +
      (statProbabilities[key] || 0) * statWeight +
      (liveScoreProbabilities?.[key] || 0) * liveWeight;
  });

  Object.assign(modelProbabilities, normalizeProbabilityMap(modelProbabilities, keys));
  keys.forEach((key) => {
    modelProbabilities[key] = round(modelProbabilities[key], 4);
  });

  const outcomeRows = keys.map((key) => {
      const best = bestOdds[key];
      const impliedAtBest = best?.price ? 1 / best.price : marketProbabilities[key] || 0;
      const edge = modelProbabilities[key] - impliedAtBest;
      return {
        key,
        label: labelForOutcome(event, key),
        probability: modelProbabilities[key],
        marketProbability: round(marketProbabilities[key] || 0, 4),
        bestBook: best?.book || "Sin casa",
        bestOdds: best?.price || null,
        edge: round(edge, 4)
      };
    });

  const valueRanked = [...outcomeRows].sort((a, b) => {
    if (b.edge !== a.edge) return b.edge - a.edge;
    return b.probability - a.probability;
  });
  const sortedByProbability = [...outcomeRows].sort((a, b) => b.probability - a.probability);
  const valueCandidate = valueRanked[0];
  const pick =
    valueCandidate.edge >= 0.035 && valueCandidate.probability >= 0.32 ? valueCandidate : sortedByProbability[0];
  const leadGap = (sortedByProbability[0]?.probability || 0) - (sortedByProbability[1]?.probability || 0);
  const agreement = clamp(1 - standardDeviation(rows.map((row) => row[pick.key]).filter(Boolean)) / 0.22, 0.35, 1);
  const samplePenalty = rows.length >= 5 ? 0 : rows.length >= 3 ? 4 : 8;
  const liveWithoutScorePenalty = event.status === "live" && !event.score ? 6 : 0;
  const volatilityPenalty = volatility > 0.3 ? 7 : volatility > 0.22 ? 3 : 0;
  const probabilityFloor = keys.includes("draw") ? 0.36 : 0.52;
  const modelMarketAgreement =
    1 -
    mean(keys.map((key) => Math.abs((modelProbabilities[key] || 0) - (marketProbabilities[key] || 0)))) /
      (keys.includes("draw") ? 0.32 : 0.24);
  const statMarketAgreement =
    1 -
    mean(keys.map((key) => Math.abs((statProbabilities[key] || 0) - (marketProbabilities[key] || 0)))) /
      (keys.includes("draw") ? 0.36 : 0.28);
  const blendedAgreement = clamp((agreement + modelMarketAgreement + statMarketAgreement) / 3, 0.22, 1);
  const rawConfidence =
    50 +
    leadGap * 92 +
    marketDepth * 16 +
    blendedAgreement * 16 -
    volatility * 30 +
    Math.max(0, pick.edge) * 78 +
    liveWeight * 10;
  const confidence = Math.round(
    clamp(rawConfidence - samplePenalty - liveWithoutScorePenalty - volatilityPenalty, 42, 92)
  );
  const strongSignal =
    confidence >= 74 &&
    pick.edge >= 0.03 &&
    pick.probability >= probabilityFloor &&
    volatility <= 0.28 &&
    rows.length >= 2;
  const moderateSignal =
    confidence >= 66 &&
    pick.edge >= 0.015 &&
    pick.probability >= probabilityFloor - 0.05 &&
    volatility <= 0.34;
  const recommendation =
    strongSignal
      ? "Filtro fuerte"
      : moderateSignal
        ? "Valor moderado"
        : "Vigilar";
  const risk = volatility > 0.3 || confidence < 62 || !moderateSignal ? "Alto" : strongSignal ? "Bajo" : "Medio";

  return {
    pick: {
      ...pick,
      probability: round(pick.probability, 4),
      confidence,
      recommendation,
      risk,
      strictSignal: strongSignal,
      trend: buildTrend(event, pick.key, pick.probability),
      reasons: buildReasons(event, pick.key, modelProbabilities, marketProbabilities)
    },
    outcomes: outcomeRows
      .sort((a, b) => b.probability - a.probability)
      .map((item) => ({
        ...item,
        probability: round(item.probability, 4),
        edge: round(item.edge, 4)
      })),
    model: {
      marketWeight: round(marketWeight, 3),
      dataQuality: round(marketDepth, 3),
      volatility: round(volatility, 3),
      statWeight: round(statWeight, 3),
      liveWeight: round(liveWeight, 3),
      generatedAt: nowIso(),
      cap: 0.88
    }
  };
}

function enrichEvents(events) {
  return events.map((event) => {
    const localized = {
      ...event,
      homeTeam: displayTeamName(event.homeTeam, event.sportKey),
      awayTeam: displayTeamName(event.awayTeam, event.sportKey)
    };
    return {
      ...localized,
      eventName: `${localized.awayTeam} @ ${localized.homeTeam}`,
      prediction: calculatePrediction(localized)
    };
  });
}

const TEAM_NAME_ES = {
  "Arizona Diamondbacks": "Diamantes de Arizona",
  "Atlanta Braves": "Bravos de Atlanta",
  "Baltimore Orioles": "Orioles de Baltimore",
  "Boston Red Sox": "Medias Rojas de Boston",
  "Chicago Cubs": "Cachorros de Chicago",
  "Chicago White Sox": "Medias Blancas de Chicago",
  "Cincinnati Reds": "Rojos de Cincinnati",
  "Cleveland Guardians": "Guardianes de Cleveland",
  "Colorado Rockies": "Rockies de Colorado",
  "Detroit Tigers": "Tigres de Detroit",
  "Houston Astros": "Astros de Houston",
  "Kansas City Royals": "Reales de Kansas City",
  "Los Angeles Angels": "Angelinos de Los Angeles",
  "Los Angeles Dodgers": "Dodgers de Los Angeles",
  "Miami Marlins": "Marlins de Miami",
  "Milwaukee Brewers": "Cerveceros de Milwaukee",
  "Minnesota Twins": "Mellizos de Minnesota",
  "New York Mets": "Mets de Nueva York",
  "New York Yankees": "Yankees de Nueva York",
  "Oakland Athletics": "Atleticos de Oakland",
  "Athletics": "Atleticos",
  "Philadelphia Phillies": "Filis de Filadelfia",
  "Pittsburgh Pirates": "Piratas de Pittsburgh",
  "San Diego Padres": "Padres de San Diego",
  "San Francisco Giants": "Gigantes de San Francisco",
  "Seattle Mariners": "Marineros de Seattle",
  "St. Louis Cardinals": "Cardenales de San Luis",
  "Tampa Bay Rays": "Rays de Tampa Bay",
  "Texas Rangers": "Rangers de Texas",
  "Toronto Blue Jays": "Azulejos de Toronto",
  "Washington Nationals": "Nacionales de Washington",
  "United States": "Estados Unidos",
  "USA": "Estados Unidos",
  "Mexico": "Mexico",
  "Brazil": "Brasil",
  "Spain": "Espana",
  "Germany": "Alemania",
  "France": "Francia",
  "England": "Inglaterra",
  "Argentina": "Argentina",
  "Uruguay": "Uruguay",
  "Portugal": "Portugal",
  "Italy": "Italia",
  "Netherlands": "Paises Bajos",
  "Belgium": "Belgica",
  "Japan": "Japon",
  "South Korea": "Corea del Sur",
  "Morocco": "Marruecos",
  "Canada": "Canada",
  "Croatia": "Croacia",
  "Switzerland": "Suiza",
  "Denmark": "Dinamarca",
  "Poland": "Polonia",
  "Australia": "Australia",
  "Serbia": "Serbia",
  "Colombia": "Colombia",
  "Chile": "Chile",
  "Ecuador": "Ecuador",
  "Peru": "Peru"
};

function displayTeamName(name, sportKey) {
  if (sportKey === "baseball_mlb") return name;
  return TEAM_NAME_ES[name] || name;
}

function estimateStatsFromOdds(event, sportKey) {
  const seed = hashString(event.id || `${event.homeTeam}-${event.awayTeam}`);
  const jitter = (offset) => ((seed % (100 + offset)) / 1000) - 0.04;
  const { probabilities } = averageMarketProbabilities(event);
  const homeBase = probabilities.home || 0.5;
  const awayBase = probabilities.away || 0.5;

  return {
    homeForm: clamp(0.45 + homeBase * 0.36 + jitter(7), 0.32, 0.82),
    awayForm: clamp(0.45 + awayBase * 0.36 + jitter(11), 0.32, 0.82),
    homeAttack: clamp(0.48 + homeBase * 0.33 + jitter(17), 0.32, 0.84),
    awayAttack: clamp(0.48 + awayBase * 0.33 + jitter(19), 0.32, 0.84),
    homeDefense: clamp(0.58 - awayBase * 0.16 + jitter(23), 0.34, 0.78),
    awayDefense: clamp(0.58 - homeBase * 0.16 + jitter(29), 0.34, 0.78),
    homeInjuryImpact: clamp(0.03 + (seed % 7) * 0.01, 0.02, 0.11),
    awayInjuryImpact: clamp(0.03 + (seed % 9) * 0.009, 0.02, 0.12),
    restEdge: clamp(((seed % 9) - 4) * 0.01, -0.05, 0.05),
    marketDepth: clamp((event.markets?.h2h?.length || 1) / 8, 0.45, 0.92),
    volatility: sportKey.includes("soccer") ? 0.18 : 0.15
  };
}

function normalizeScoreName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreKey(homeTeam, awayTeam) {
  return `${normalizeScoreName(homeTeam)}|||${normalizeScoreName(awayTeam)}`;
}

function scoreFromProvider(item) {
  const scores = Array.isArray(item.scores) ? item.scores : [];
  const homeName = normalizeScoreName(item.home_team);
  const awayName = normalizeScoreName(item.away_team);
  const homeScore = scores.find((score) => normalizeScoreName(score.name) === homeName);
  const awayScore = scores.find((score) => normalizeScoreName(score.name) === awayName);
  if (!homeScore || !awayScore) return null;
  const home = Number(homeScore.score);
  const away = Number(awayScore.score);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

async function fetchScoresForSport(sportKey) {
  const scores = new Map();
  if (process.env.ENABLE_SCORES === "false") return scores;
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/scores`);
  url.searchParams.set("apiKey", ODDS_API_KEY);
  url.searchParams.set("daysFrom", "1");
  url.searchParams.set("dateFormat", "iso");

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return scores;
  const data = await response.json();
  (Array.isArray(data) ? data : []).forEach((item) => {
    scores.set(scoreKey(item.home_team, item.away_team), {
      score: scoreFromProvider(item),
      completed: Boolean(item.completed),
      lastUpdate: item.last_update || item.lastUpdate || null
    });
  });
  return scores;
}

function transformOddsApiEvent(item, sportKey, scoreInfo = null) {
  const h2h = [];
  const spreads = [];
  const totals = [];

  (item.bookmakers || []).forEach((bookmaker) => {
    const row = { book: bookmaker.title || bookmaker.key || "Bookmaker", updatedMins: 1 };
    const spreadRow = { book: row.book };
    const totalRow = { book: row.book };

    (bookmaker.markets || []).forEach((market) => {
      if (market.key === "h2h") {
        (market.outcomes || []).forEach((outcome) => {
          const outcomeName = (outcome.name || "").toLowerCase();
          if (outcomeName === (item.home_team || "").toLowerCase()) row.home = outcome.price;
          if (outcomeName === (item.away_team || "").toLowerCase()) row.away = outcome.price;
          if (outcomeName === "draw") row.draw = outcome.price;
        });
      }

      if (market.key === "spreads") {
        (market.outcomes || []).forEach((outcome) => {
          const outcomeName = (outcome.name || "").toLowerCase();
          if (outcomeName === (item.home_team || "").toLowerCase()) {
            spreadRow.home = outcome.price;
            spreadRow.homeLine = outcome.point;
          }
          if (outcomeName === (item.away_team || "").toLowerCase()) {
            spreadRow.away = outcome.price;
            spreadRow.awayLine = outcome.point;
          }
        });
      }

      if (market.key === "totals") {
        (market.outcomes || []).forEach((outcome) => {
          const outcomeName = (outcome.name || "").toLowerCase();
          if (outcomeName === "over") {
            totalRow.over = outcome.price;
            totalRow.line = outcome.point;
          }
          if (outcomeName === "under") {
            totalRow.under = outcome.price;
            totalRow.line = outcome.point;
          }
        });
      }
    });

    if (Number.isFinite(row.home) && Number.isFinite(row.away)) h2h.push(row);
    if (Number.isFinite(spreadRow.home) && Number.isFinite(spreadRow.away)) spreads.push(spreadRow);
    if (Number.isFinite(totalRow.over) && Number.isFinite(totalRow.under)) totals.push(totalRow);
  });

  const event = {
    id: item.id || `${sportKey}-${item.home_team}-${item.away_team}`,
    sport: sportKeyToName(sportKey),
    sportKey,
    league: sportKeyToLeague(sportKey),
    homeTeam: item.home_team || "Local",
    awayTeam: item.away_team || "Visitante",
    venue: "Proveedor externo",
    status: runtimeStatusForEvent({
      sportKey,
      commenceTime: item.commence_time,
      status: scoreInfo?.completed ? "final" : "upcoming",
      score: scoreInfo?.score || null
    }),
    commenceTime: item.commence_time,
    score: scoreInfo?.score || null,
    scoreSource: scoreInfo?.score ? "Marcador oficial del proveedor" : "",
    scoreUpdatedAt: scoreInfo?.lastUpdate || null,
    dataSource: "The Odds API",
    isDemo: false,
    markets: {
      h2h,
      spreads,
      totals
    }
  };

  event.stats = estimateStatsFromOdds(event, sportKey);
  return event;
}

function sportKeyToName(sportKey) {
  if (sportKey.includes("soccer")) return "Futbol";
  if (sportKey.includes("basketball_wnba")) return "WNBA";
  if (sportKey.includes("basketball")) return "NBA";
  if (sportKey.includes("baseball")) return "Beisbol";
  if (sportKey.includes("americanfootball")) return "Futbol Americano";
  if (sportKey.includes("icehockey")) return "Hockey";
  if (sportKey.includes("mma")) return "MMA";
  if (sportKey.includes("boxing")) return "Box";
  if (sportKey.includes("tennis")) return "Tenis";
  return "Deporte";
}

function sportKeyToLeague(sportKey) {
  const leagueNames = {
    baseball_mlb: "MLB",
    soccer_fifa_world_cup: "Copa Mundial FIFA",
    soccer_mexico_ligamx: "Liga MX",
    soccer_epl: "Premier League",
    soccer_spain_la_liga: "La Liga",
    soccer_uefa_champs_league: "Champions League"
  };
  if (leagueNames[sportKey]) return leagueNames[sportKey];
  const parts = sportKey.split("_");
  return parts.slice(1).join(" ").toUpperCase() || sportKey;
}

async function fetchLiveFeed() {
  const events = [];
  const errors = [];
  let quota = null;

  for (const sportKey of SPORT_KEYS) {
    let scoreMap = new Map();
    try {
      scoreMap = await fetchScoresForSport(sportKey);
    } catch (error) {
      errors.push(`${sportKey} scores: ${error.message}`);
    }

    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
    url.searchParams.set("apiKey", ODDS_API_KEY);
    url.searchParams.set("regions", ODDS_REGIONS);
    url.searchParams.set("markets", ODDS_MARKETS);
    url.searchParams.set("oddsFormat", "decimal");
    url.searchParams.set("dateFormat", "iso");

    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      quota = {
        remaining: response.headers.get("x-requests-remaining"),
        used: response.headers.get("x-requests-used")
      };

      if (!response.ok) {
        const text = await response.text();
        errors.push(`${sportKey}: ${response.status} ${text.slice(0, 160)}`);
        continue;
      }

      const data = await response.json();
      data.forEach((item) => {
        const transformed = transformOddsApiEvent(item, sportKey, scoreMap.get(scoreKey(item.home_team, item.away_team)));
        if (transformed.markets.h2h.length) events.push(transformed);
      });
    } catch (error) {
      errors.push(`${sportKey}: ${error.message}`);
    }
  }

  return { events, errors, quota };
}

async function refreshFeed(reason = "schedule") {
  const providerErrors = [];
  let events = [];
  let provider = "Demo local";
  let feedMode = "demo";
  let quota = null;

  if (ODDS_API_KEY) {
    const liveFeed = await fetchLiveFeed();
    if (liveFeed.events.length) {
      events = mergeWithEventCache(liveFeed.events);
      provider = "The Odds API";
      feedMode = "live";
      quota = liveFeed.quota;
    } else if (cachedProviderEvents().length) {
      events = cachedProviderEvents();
      provider = "The Odds API";
      feedMode = "live";
      providerErrors.push(...liveFeed.errors, "Sin cuotas nuevas; usando eventos recientes en cache para mantener estados en vivo.");
      quota = liveFeed.quota;
    } else {
      events = buildDemoFeed();
      provider = "Demo local";
      feedMode = "demo-fallback";
      providerErrors.push(...liveFeed.errors, "No llegaron eventos validos; se activo demo local.");
      quota = liveFeed.quota;
    }
  } else {
    events = buildDemoFeed();
  }

  feedState = {
    events: enrichEvents(normalizeRuntimeEvents(events)),
    feedMode,
    provider,
    providerErrors,
    lastRefreshAt: nowIso(),
    nextRefreshAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
    refreshCount: feedState.refreshCount + 1,
    quota,
    reason
  };

  broadcastSnapshot();
}

function isInsideScoreWindow(event, now = Date.now()) {
  const startMs = new Date(event.commenceTime).getTime();
  if (!Number.isFinite(startMs)) return false;
  const pregameWindow = 20 * 60 * 1000;
  const postgameWindow = 45 * 60 * 1000;
  return now >= startMs - pregameWindow && now <= startMs + liveWindowMsForSport(event.sportKey) + postgameWindow;
}

function activeScoreSports() {
  return [
    ...new Set(
      feedState.events
        .filter((event) => event.sportKey && isInsideScoreWindow(event))
        .map((event) => event.sportKey)
    )
  ];
}

function applyScoreInfoToEvent(event, scoreInfo) {
  if (!scoreInfo) return normalizeRuntimeEvent(event);
  const score = scoreInfo.score || event.score || null;
  return normalizeRuntimeEvent({
    ...event,
    score,
    scoreSource: score ? "Marcador oficial del proveedor" : event.scoreSource,
    scoreUpdatedAt: scoreInfo.lastUpdate || nowIso(),
    status: scoreInfo.completed ? "final" : event.status
  });
}

async function refreshLiveScores(reason = "score") {
  if (!ODDS_API_KEY || scoreRefreshInFlight || !feedState.events.length) return;
  const sportKeys = activeScoreSports();
  if (!sportKeys.length) return;

  scoreRefreshInFlight = true;
  try {
    const scoreMaps = new Map();
    for (const sportKey of sportKeys) {
      scoreMaps.set(sportKey, await fetchScoresForSport(sportKey));
    }

    const updatedEvents = feedState.events.map((event) => {
      const scoreInfo = scoreMaps.get(event.sportKey)?.get(scoreKey(event.homeTeam, event.awayTeam));
      return applyScoreInfoToEvent(event, scoreInfo);
    });
    const enrichedEvents = enrichEvents(normalizeRuntimeEvents(updatedEvents));
    enrichedEvents.forEach((event) => eventCache.set(eventCacheKey(event), event));

    feedState = {
      ...feedState,
      events: enrichedEvents,
      lastRefreshAt: nowIso(),
      nextRefreshAt: new Date(Date.now() + LIVE_TICK_INTERVAL_MS).toISOString(),
      reason,
      scoreRefreshAt: nowIso()
    };
    broadcastSnapshot();
  } catch (error) {
    feedState.providerErrors = [...(feedState.providerErrors || []), `scores: ${error.message}`].slice(-6);
  } finally {
    scoreRefreshInFlight = false;
  }
}

function filterEvents(searchParams) {
  const query = (searchParams.get("q") || "").trim().toLowerCase();
  const sport = (searchParams.get("sport") || "all").trim();
  const confidence = Number(searchParams.get("confidence") || 0);

  return feedState.events.filter((event) => {
    const queryMatches =
      !query ||
      [
        event.eventName,
        event.homeTeam,
        event.awayTeam,
        event.league,
        event.sport,
        event.prediction?.pick?.label,
        event.prediction?.pick?.bestBook
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    const sportMatches = sport === "all" || event.sport === sport;
    const confidenceMatches = (event.prediction?.pick?.confidence || 0) >= confidence;
    return queryMatches && sportMatches && confidenceMatches;
  });
}

function buildPayload(events) {
  const opportunities = events.filter((event) => {
    const pick = event.prediction?.pick;
    return pick && pick.recommendation !== "Vigilar" && pick.confidence >= 72 && pick.risk !== "Alto";
  }).length;
  const sports = [...new Set(feedState.events.map((event) => event.sport))].sort();

  return {
    ...feedState,
    events,
    sports,
    summary: {
      totalEvents: events.length,
      opportunities,
      liveEvents: events.filter((event) => event.status === "live").length,
      averageConfidence: events.length
        ? Math.round(events.reduce((sum, event) => sum + event.prediction.pick.confidence, 0) / events.length)
        : 0
    },
    disclaimer: "Estimaciones probabilisticas; no garantizan aciertos ni resultados financieros."
  };
}

function broadcastSnapshot() {
  const payload = JSON.stringify(buildPayload(feedState.events));
  for (const response of clients) {
    response.write(`event: snapshot\n`);
    response.write(`data: ${payload}\n\n`);
  }
}

function tickPredictions() {
  if (!feedState.events.length) return;

  if (feedState.feedMode === "demo" || feedState.feedMode === "demo-fallback") {
    feedState.events = enrichEvents(buildDemoFeed());
  } else {
    const cachedEvents = cachedProviderEvents();
    feedState.events = enrichEvents(cachedEvents.length ? cachedEvents : normalizeRuntimeEvents(feedState.events));
  }

  feedState.lastRefreshAt = nowIso();
  feedState.nextRefreshAt = new Date(Date.now() + LIVE_TICK_INTERVAL_MS).toISOString();
  broadcastSnapshot();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }));
  response.end(JSON.stringify(payload));
}

function notFound(response) {
  response.writeHead(404, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
  response.end("No encontrado");
}

async function serveStatic(requestUrl, response) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(response);
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      notFound(response);
      return;
    }

    response.writeHead(200, securityHeaders({
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache"
    }));
    fs.createReadStream(filePath).pipe(response);
  } catch {
    notFound(response);
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && requestUrl.pathname === "/login") {
    if (getSession(request)) {
      sendRedirect(response, "/");
      return;
    }
    await serveStatic(new URL("/login.html", requestUrl), response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/register") {
    await registerUser(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/login") {
    await loginUser(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/recovery/start") {
    await startRecovery(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/recovery/confirm") {
    await confirmRecovery(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/logout") {
    const session = requireAuth(request, response);
    if (!session || !requireCsrf(request, response, session)) return;
    sessions.delete(session.tokenHash);
    await saveSessions();
    response.writeHead(
      200,
      securityHeaders({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": clearSessionCookie()
      })
    );
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/me") {
    const session = getSession(request);
    if (!session) {
      sendAuthRequired(response);
      return;
    }
    sendJson(response, 200, { authenticated: true, user: publicUser(session), csrfToken: session.csrfToken });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/profile") {
    const session = requireAuth(request, response);
    if (!session) return;
    sendJson(response, 200, { user: publicUser(session) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/settings") {
    const session = requireAuth(request, response);
    if (!session || !requireCsrf(request, response, session)) return;
    await updateSettings(request, response, session);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/profile") {
    const session = requireAuth(request, response);
    if (!session || !requireCsrf(request, response, session)) return;
    await updateProfile(request, response, session);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/events") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, buildPayload(filterEvents(requestUrl.searchParams)));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/status") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, {
      feedMode: feedState.feedMode,
      provider: feedState.provider,
      providerErrors: feedState.providerErrors,
      lastRefreshAt: feedState.lastRefreshAt,
      nextRefreshAt: feedState.nextRefreshAt,
      refreshCount: feedState.refreshCount,
      pollIntervalMs: POLL_INTERVAL_MS,
      scorePollIntervalMs: SCORE_POLL_INTERVAL_MS,
      quota: feedState.quota,
      hasLiveKey: Boolean(ODDS_API_KEY)
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/refresh") {
    const session = requireAuth(request, response);
    if (!session || !requireCsrf(request, response, session)) return;
    await refreshFeed("manual");
    sendJson(response, 200, buildPayload(feedState.events));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/stream") {
    if (!requireAuth(request, response)) return;
    response.writeHead(200, securityHeaders({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    }));
    response.write(": connected\n\n");
    clients.add(response);
    response.write(`event: snapshot\n`);
    response.write(`data: ${JSON.stringify(buildPayload(feedState.events))}\n\n`);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "GET") {
    if ((requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") && !getSession(request)) {
      sendRedirect(response, "/login");
      return;
    }
    await serveStatic(requestUrl, response);
    return;
  }

  notFound(response);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    sendJson(response, 500, { error: "Error interno", detail: error.message });
  });
});

ensureDataStore()
  .then(() => refreshFeed("startup"))
  .then(() => {
    setInterval(() => refreshFeed("schedule").catch((error) => console.error(error)), POLL_INTERVAL_MS);
    setInterval(() => refreshLiveScores("score").catch((error) => console.error(error)), SCORE_POLL_INTERVAL_MS);
    setInterval(() => tickPredictions(), LIVE_TICK_INTERVAL_MS);
    setInterval(() => {
      for (const response of clients) response.write(": heartbeat\n\n");
    }, 1000);
    server.listen(PORT, () => {
      console.log(`PickPro listo en http://localhost:${PORT}`);
      console.log(`Modo: ${feedState.feedMode} | Proveedor: ${feedState.provider}`);
      console.log(`Usuarios: ${HAS_SUPABASE_STORE ? "Supabase" : "archivo local"}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar PickPro", error);
    process.exit(1);
  });
