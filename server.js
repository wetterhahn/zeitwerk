import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageMetadata from './package.json' with { type: 'json' };
import { importWorkbook } from './src/import-workbook.js';
import { clearSession, clearUserSessions, createSession, passwordMatches, passwordNeedsUpgrade, passwordRecord, publicUser, sessionUserId, validateCredentials, validateEmployee } from './src/auth.js';
import { readStore, writeStore } from './src/storage.js';
import { createManualWeek } from './src/week.js';

const app = express();
const appVersion = packageMetadata.version;
const port = Number(process.env.PORT || 3000);
const uploadLimit = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 25)) * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: uploadLimit, files: 1 } });
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const loginAttempts = new Map();
const loginWindow = 15 * 60 * 1000;
let dummyPasswordRecord;
const dummyPassword = async () => { dummyPasswordRecord ||= passwordRecord(crypto.randomBytes(32).toString('hex')); return dummyPasswordRecord; };

app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  if (secureRequest(request)) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '2mb' }));

const secureRequest = (request) => request.secure;
const credentialsFrom = (body, requirePassword = true) => {
  try { return validateCredentials(body, requirePassword); }
  catch (error) { error.status = 400; throw error; }
};
const duplicateUser = (users, credentials, excludedId) => users.find((user) => user.id !== excludedId && user.username === credentials.username);
const employeeFrom = (store, employeeId) => store.employees.find((employee) => employee.id === employeeId);
const employeeWithAccount = (store, employee) => ({ ...employee, account: store.users.find((user) => user.employeeId === employee.id) ? publicUser(store.users.find((user) => user.employeeId === employee.id)) : null });
const attemptKey = (value) => crypto.createHash('sha256').update(value).digest('hex');
const loginKeys = (request, username) => { const address = request.socket.remoteAddress || 'unknown'; return [{ key: attemptKey(`ip:${address}`), maximum: 20 }, { key: attemptKey(`pair:${address}:${username}`), maximum: 5 }]; };
const retryAfter = (request, username) => loginKeys(request, username).reduce((seconds, item) => {
  const record = loginAttempts.get(item.key);
  if (!record || record.resetAt <= Date.now() || record.count < item.maximum) return seconds;
  return Math.max(seconds, Math.ceil((record.resetAt - Date.now()) / 1000));
}, 0);
const failedLogin = (request, username) => {
  const now = Date.now();
  for (const item of loginKeys(request, username)) {
    const previous = loginAttempts.get(item.key);
    const record = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + loginWindow } : previous;
    record.count += 1;
    loginAttempts.set(item.key, record);
  }
};
const successfulLogin = (request, username) => loginAttempts.delete(loginKeys(request, username)[1].key);
setInterval(() => { const now = Date.now(); for (const [key, record] of loginAttempts) if (record.resetAt <= now) loginAttempts.delete(key); }, 10 * 60 * 1000).unref();

app.use('/api', (request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/health', (request, response) => response.json({ status: 'ok', version: appVersion }));
app.get('/api/session', async (request, response, next) => {
  try {
    const store = await readStore();
    if (!store.users.length) return response.json({ setupRequired: true, authenticated: false });
    const userId = sessionUserId(request);
    const user = store.users.find((candidate) => candidate.id === userId && candidate.active);
    response.json({ setupRequired: false, authenticated: Boolean(user), user: user ? publicUser(user) : null });
  } catch (error) { next(error); }
});

app.use('/api', (request, response, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (request.get('X-Zeitwerk-Request') !== '1' || request.get('Sec-Fetch-Site') === 'cross-site') return response.status(403).json({ error: 'Ungültige Anfrage.' });
    const origin = request.get('Origin');
    if (origin && origin !== `${request.protocol}://${request.get('host')}`) return response.status(403).json({ error: 'Ungültige Anfrage.' });
  }
  next();
});

app.post('/api/setup', async (request, response, next) => {
  try {
    const store = await readStore();
    if (store.users.length) return response.status(409).json({ error: 'Die Ersteinrichtung wurde bereits abgeschlossen.' });
    const credentials = credentialsFrom(request.body);
    const password = await passwordRecord(credentials.password);
    const employee = { id: crypto.randomUUID(), name: credentials.name, personnelNumber: credentials.personnelNumber, active: true, createdAt: new Date().toISOString() };
    const user = { id: crypto.randomUUID(), employeeId: employee.id, username: credentials.username, name: employee.name, personnelNumber: employee.personnelNumber, active: true, createdAt: new Date().toISOString(), ...password };
    store.employees.push(employee);
    store.users.push(user);
    await writeStore(store);
    createSession(request, response, user.id, secureRequest(request));
    response.status(201).json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/login', async (request, response, next) => {
  try {
    const store = await readStore();
    const username = String(request.body.username || '').trim().toLowerCase();
    const waitSeconds = retryAfter(request, username);
    if (waitSeconds > 0) { response.setHeader('Retry-After', String(waitSeconds)); return response.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' }); }
    const user = store.users.find((candidate) => candidate.username === username);
    const password = String(request.body.password || '');
    const validPassword = await passwordMatches(password, user?.active ? user : await dummyPassword());
    if (!user?.active || !validPassword) {
      failedLogin(request, username);
      return response.status(401).json({ error: 'Benutzername oder Passwort ist falsch.' });
    }
    successfulLogin(request, username);
    if (passwordNeedsUpgrade(user)) { Object.assign(user, await passwordRecord(password)); await writeStore(store); }
    createSession(request, response, user.id, secureRequest(request));
    response.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/logout', (request, response) => {
  clearSession(request, response);
  response.json({ ok: true });
});

app.use('/api', async (request, response, next) => {
  try {
    const store = await readStore();
    const userId = sessionUserId(request);
    const user = store.users.find((candidate) => candidate.id === userId && candidate.active);
    if (!user) return response.status(401).json({ error: 'Bitte erneut anmelden.' });
    request.currentUser = user;
    next();
  } catch (error) { next(error); }
});

app.get('/api/users', async (request, response, next) => {
  try {
    const store = await readStore();
    response.json({ users: store.users.map(publicUser) });
  } catch (error) { next(error); }
});

app.get('/api/employees', async (request, response, next) => {
  try {
    const store = await readStore();
    response.json({ employees: store.employees.map((employee) => employeeWithAccount(store, employee)) });
  } catch (error) { next(error); }
});

app.post('/api/employees', async (request, response, next) => {
  try {
    const store = await readStore();
    const details = validateEmployee(request.body);
    if (store.employees.some((employee) => String(employee.personnelNumber) === details.personnelNumber)) return response.status(409).json({ error: 'Diese Personalnummer ist bereits vergeben.' });
    const employee = { id: crypto.randomUUID(), ...details, active: true, createdAt: new Date().toISOString() };
    if (request.body.loginEnabled === true) {
      const credentials = credentialsFrom({ ...request.body, ...details });
      if (duplicateUser(store.users, credentials)) return response.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
      const password = await passwordRecord(credentials.password);
      store.users.push({ id: crypto.randomUUID(), employeeId: employee.id, username: credentials.username, name: employee.name, personnelNumber: employee.personnelNumber, active: true, createdAt: new Date().toISOString(), ...password });
    }
    store.employees.push(employee);
    await writeStore(store);
    response.status(201).json({ employee: employeeWithAccount(store, employee) });
  } catch (error) { error.status ||= 400; next(error); }
});

app.put('/api/employees/:employeeId', async (request, response, next) => {
  try {
    const store = await readStore();
    const employee = employeeFrom(store, request.params.employeeId);
    if (!employee) return response.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    const details = validateEmployee(request.body);
    if (store.employees.some((item) => item.id !== employee.id && String(item.personnelNumber) === details.personnelNumber)) return response.status(409).json({ error: 'Diese Personalnummer ist bereits vergeben.' });
    const active = request.body.active !== false;
    const userIndex = store.users.findIndex((user) => user.employeeId === employee.id);
    const user = userIndex >= 0 ? store.users[userIndex] : null;
    if (user?.id === request.currentUser.id && !active) return response.status(400).json({ error: 'Der eigene Mitarbeiter kann nicht deaktiviert werden.' });
    let refreshCurrentSession = false;
    if (request.body.loginEnabled === true) {
      const credentials = credentialsFrom({ ...request.body, ...details }, !user);
      if (duplicateUser(store.users, credentials, user?.id)) return response.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
      if (user) {
        Object.assign(user, { username: credentials.username, name: details.name, personnelNumber: details.personnelNumber, active });
        if (credentials.password) { Object.assign(user, await passwordRecord(credentials.password)); clearUserSessions(user.id); refreshCurrentSession = user.id === request.currentUser.id; }
      } else {
        const password = await passwordRecord(credentials.password);
        store.users.push({ id: crypto.randomUUID(), employeeId: employee.id, username: credentials.username, name: details.name, personnelNumber: details.personnelNumber, active, createdAt: new Date().toISOString(), ...password });
      }
    } else if (user) {
      if (user.id === request.currentUser.id) return response.status(400).json({ error: 'Die Anmeldung des eigenen Kontos kann nicht entfernt werden.' });
      clearUserSessions(user.id);
      store.users.splice(userIndex, 1);
    }
    Object.assign(employee, details, { active });
    await writeStore(store);
    if (refreshCurrentSession) createSession(request, response, request.currentUser.id, secureRequest(request));
    response.json({ employee: employeeWithAccount(store, employee) });
  } catch (error) { error.status ||= 400; next(error); }
});

app.delete('/api/employees/:employeeId', async (request, response, next) => {
  try {
    const store = await readStore();
    const employeeIndex = store.employees.findIndex((employee) => employee.id === request.params.employeeId);
    if (employeeIndex < 0) return response.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    const linkedUsers = store.users.filter((user) => user.employeeId === request.params.employeeId);
    if (linkedUsers.some((user) => user.id === request.currentUser.id)) return response.status(400).json({ error: 'Der eigene Mitarbeiter kann nicht gelöscht werden.' });
    linkedUsers.forEach((user) => clearUserSessions(user.id));
    store.users = store.users.filter((user) => user.employeeId !== request.params.employeeId);
    const [employee] = store.employees.splice(employeeIndex, 1);
    await writeStore(store);
    response.json({ ok: true, message: `${employee.name} wurde gelöscht. Bereits erfasste Wochen bleiben als Historie erhalten.` });
  } catch (error) { next(error); }
});

app.post('/api/users', async (request, response, next) => {
  try {
    const store = await readStore();
    const employee = employeeFrom(store, String(request.body.employeeId || ''));
    if (!employee) return response.status(400).json({ error: 'Bitte einen vorhandenen Mitarbeiter auswählen.' });
    const credentials = credentialsFrom({ ...request.body, name: employee.name, personnelNumber: employee.personnelNumber });
    if (duplicateUser(store.users, credentials)) return response.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
    if (store.users.some((user) => user.employeeId === employee.id)) return response.status(409).json({ error: 'Für diesen Mitarbeiter existiert bereits ein Benutzerkonto.' });
    const password = await passwordRecord(credentials.password);
    const user = { id: crypto.randomUUID(), employeeId: employee.id, username: credentials.username, name: employee.name, personnelNumber: employee.personnelNumber, active: true, createdAt: new Date().toISOString(), ...password };
    store.users.push(user);
    await writeStore(store);
    response.status(201).json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.put('/api/users/:userId', async (request, response, next) => {
  try {
    const store = await readStore();
    const user = store.users.find((candidate) => candidate.id === request.params.userId);
    if (!user) return response.status(404).json({ error: 'Benutzer nicht gefunden.' });
    const employee = employeeFrom(store, String(request.body.employeeId || user.employeeId || ''));
    if (!employee) return response.status(400).json({ error: 'Bitte einen vorhandenen Mitarbeiter auswählen.' });
    const credentials = credentialsFrom({ ...request.body, name: employee.name, personnelNumber: employee.personnelNumber }, false);
    if (duplicateUser(store.users, credentials, user.id)) return response.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
    if (store.users.some((item) => item.id !== user.id && item.employeeId === employee.id)) return response.status(409).json({ error: 'Für diesen Mitarbeiter existiert bereits ein Benutzerkonto.' });
    const active = request.body.active !== false;
    if (user.id === request.currentUser.id && !active) return response.status(400).json({ error: 'Das eigene Konto kann nicht deaktiviert werden.' });
    Object.assign(user, { employeeId: employee.id, username: credentials.username, name: employee.name, personnelNumber: employee.personnelNumber, active });
    if (credentials.password) { Object.assign(user, await passwordRecord(credentials.password)); clearUserSessions(user.id); }
    if (!active) clearUserSessions(user.id);
    await writeStore(store);
    if (credentials.password && user.id === request.currentUser.id) createSession(request, response, user.id, secureRequest(request));
    response.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.get('/api/weeks', async (request, response, next) => {
  try {
    const store = await readStore();
    const weeks = Object.values(store.weeks).map(({ employees, orders, ...week }) => ({ ...week, employeeCount: employees.length, orderCount: orders.length }));
    weeks.sort((a, b) => b.startDate.localeCompare(a.startDate));
    response.json({ weeks });
  } catch (error) { next(error); }
});

app.post('/api/weeks', async (request, response, next) => {
  try {
    const store = await readStore();
    let week;
    try { week = createManualWeek({ year: request.body.year, weekNumber: request.body.weekNumber, employees: store.employees }); }
    catch (error) { return response.status(400).json({ error: error.message }); }
    if (store.weeks[week.id]) return response.status(409).json({ error: `KW ${week.weekNumber}/${week.year} ist bereits vorhanden.` });
    if (!week.employees.length) return response.status(400).json({ error: 'Mindestens ein aktiver Mitarbeiter wird benötigt.' });
    store.weeks[week.id] = week;
    await writeStore(store);
    response.status(201).json({ week, message: `KW ${week.weekNumber}/${week.year} wurde angelegt.` });
  } catch (error) { next(error); }
});

app.get('/api/weeks/:weekId', async (request, response, next) => {
  try {
    const store = await readStore();
    const week = store.weeks[request.params.weekId];
    if (!week) return response.status(404).json({ error: 'Kalenderwoche nicht gefunden.' });
    response.json({ week });
  } catch (error) { next(error); }
});

app.post('/api/import', upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: 'Bitte eine XLSX-Datei auswählen.' });
    if (!request.file.originalname.toLowerCase().endsWith('.xlsx')) return response.status(400).json({ error: 'Es werden ausschließlich XLSX-Dateien unterstützt.' });
    if (request.file.buffer.length < 4 || request.file.buffer[0] !== 0x50 || request.file.buffer[1] !== 0x4b) return response.status(400).json({ error: 'Die Datei ist keine gültige XLSX-Datei.' });
    const week = await importWorkbook(request.file.buffer, path.basename(request.file.originalname));
    const store = await readStore();
    store.weeks[week.id] = { ...week, source: 'excel' };
    for (const imported of week.employees) {
      const personnelNumber = String(imported.id);
      const existing = store.employees.find((employee) => String(employee.personnelNumber) === personnelNumber);
      if (existing) existing.name = imported.name;
      else store.employees.push({ id: crypto.randomUUID(), name: imported.name, personnelNumber, active: true, createdAt: new Date().toISOString() });
    }
    await writeStore(store);
    response.status(201).json({ week: store.weeks[week.id], message: `KW ${week.weekNumber} wurde erfolgreich importiert.` });
  } catch (error) { next(error); }
});

app.put('/api/weeks/:weekId/employees/:employeeId', async (request, response, next) => {
  try {
    const store = await readStore();
    const week = store.weeks[request.params.weekId];
    if (!week) return response.status(404).json({ error: 'Kalenderwoche nicht gefunden.' });
    const index = week.employees.findIndex((employee) => String(employee.id) === request.params.employeeId);
    if (index < 0) return response.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    if (!Array.isArray(request.body.days) || request.body.days.length !== 5) return response.status(400).json({ error: 'Es werden fünf Arbeitstage erwartet.' });
    week.employees[index].days = request.body.days;
    week.updatedAt = new Date().toISOString();
    await writeStore(store);
    response.json({ employee: week.employees[index] });
  } catch (error) { next(error); }
});

app.put('/api/weeks/:weekId/orders', async (request, response, next) => {
  try {
    const store = await readStore();
    const week = store.weeks[request.params.weekId];
    if (!week) return response.status(404).json({ error: 'Kalenderwoche nicht gefunden.' });
    if (!Array.isArray(request.body.orders) || request.body.orders.some((order) => !String(order.number || '').trim() || !String(order.name || '').trim())) return response.status(400).json({ error: 'Jeder Auftrag benötigt Auftragsnummer und Bezeichnung.' });
    week.orders = request.body.orders.map((order) => ({ ...order, number: String(order.number).trim(), name: String(order.name).trim(), description: String(order.description || '').trim(), requester: String(order.requester || '').trim(), active: order.active !== false }));
    if (Array.isArray(request.body.employees)) {
      const validOrderIds = new Set(week.orders.map((order) => order.id));
      for (const incoming of request.body.employees) {
        const employee = week.employees.find((item) => String(item.id) === String(incoming.id));
        if (!employee || !Array.isArray(incoming.days) || incoming.days.length !== 5) continue;
        incoming.days.forEach((day, dayIndex) => {
          if (!Array.isArray(day.allocations)) return;
          employee.days[dayIndex].allocations = day.allocations.filter((allocation) => validOrderIds.has(allocation.orderId) && Number(allocation.hours) >= 0).map((allocation) => ({ orderId: allocation.orderId, hours: Number(allocation.hours) }));
        });
      }
    }
    week.updatedAt = new Date().toISOString();
    await writeStore(store);
    response.json({ orders: week.orders });
  } catch (error) { next(error); }
});

app.use(express.static(publicDirectory, {
  index: 'index.html',
  etag: true,
  maxAge: 0,
  setHeaders: (response) => response.setHeader('Cache-Control', 'no-cache')
}));
app.get('*splat', (request, response) => response.sendFile(path.join(publicDirectory, 'index.html')));

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: 'Die Datei ist größer als das erlaubte Upload-Limit.' });
  console.error(error);
  const status = Number(error.status) >= 400 && Number(error.status) < 500 ? Number(error.status) : 500;
  response.status(status).json({ error: status === 500 ? 'Interner Fehler.' : error.message });
});

let listeningServer;
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  listeningServer = app.listen(port, '0.0.0.0', () => console.log(`Zeitwerk läuft auf Port ${port}`));
}

export { app, listeningServer };
