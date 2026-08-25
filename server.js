import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importWorkbook } from './src/import-workbook.js';
import { clearSession, createSession, passwordMatches, passwordRecord, publicUser, sessionUserId, validateCredentials } from './src/auth.js';
import { readStore, writeStore } from './src/storage.js';
import { createManualWeek } from './src/week.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const uploadLimit = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 25)) * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: uploadLimit, files: 1 } });
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'");
  next();
});
app.use(express.json({ limit: '2mb' }));

const secureRequest = (request) => request.secure || String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const credentialsFrom = (body, requirePassword = true) => {
  try { return validateCredentials(body, requirePassword); }
  catch (error) { error.status = 400; throw error; }
};
const duplicateUser = (users, credentials, excludedId) => users.find((user) => user.id !== excludedId && (user.username === credentials.username || String(user.personnelNumber) === credentials.personnelNumber));

app.get('/api/health', (request, response) => response.json({ status: 'ok' }));
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
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('X-Zeitwerk-Request') !== '1') return response.status(403).json({ error: 'Ungültige Anfrage.' });
  next();
});

app.post('/api/setup', async (request, response, next) => {
  try {
    const store = await readStore();
    if (store.users.length) return response.status(409).json({ error: 'Die Ersteinrichtung wurde bereits abgeschlossen.' });
    const credentials = credentialsFrom(request.body);
    const password = await passwordRecord(credentials.password);
    const user = { id: crypto.randomUUID(), username: credentials.username, name: credentials.name, personnelNumber: credentials.personnelNumber, active: true, createdAt: new Date().toISOString(), ...password };
    store.users.push(user);
    await writeStore(store);
    createSession(response, user.id, secureRequest(request));
    response.status(201).json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/login', async (request, response, next) => {
  try {
    const store = await readStore();
    const username = String(request.body.username || '').trim().toLowerCase();
    const user = store.users.find((candidate) => candidate.username === username && candidate.active);
    if (!user || !(await passwordMatches(String(request.body.password || ''), user))) return response.status(401).json({ error: 'Benutzername oder Passwort ist falsch.' });
    createSession(response, user.id, secureRequest(request));
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

app.post('/api/users', async (request, response, next) => {
  try {
    const store = await readStore();
    const credentials = credentialsFrom(request.body);
    if (duplicateUser(store.users, credentials)) return response.status(409).json({ error: 'Benutzername oder Personalnummer ist bereits vergeben.' });
    const password = await passwordRecord(credentials.password);
    const user = { id: crypto.randomUUID(), username: credentials.username, name: credentials.name, personnelNumber: credentials.personnelNumber, active: true, createdAt: new Date().toISOString(), ...password };
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
    const credentials = credentialsFrom(request.body, false);
    if (duplicateUser(store.users, credentials, user.id)) return response.status(409).json({ error: 'Benutzername oder Personalnummer ist bereits vergeben.' });
    const active = request.body.active !== false;
    if (user.id === request.currentUser.id && !active) return response.status(400).json({ error: 'Das eigene Konto kann nicht deaktiviert werden.' });
    Object.assign(user, { username: credentials.username, name: credentials.name, personnelNumber: credentials.personnelNumber, active });
    if (credentials.password) Object.assign(user, await passwordRecord(credentials.password));
    await writeStore(store);
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
    try { week = createManualWeek({ year: request.body.year, weekNumber: request.body.weekNumber, users: store.users }); }
    catch (error) { return response.status(400).json({ error: error.message }); }
    if (store.weeks[week.id]) return response.status(409).json({ error: `KW ${week.weekNumber}/${week.year} ist bereits vorhanden.` });
    if (!week.employees.length) return response.status(400).json({ error: 'Mindestens ein aktiver Benutzer wird benötigt.' });
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
    const week = await importWorkbook(request.file.buffer, path.basename(request.file.originalname));
    const store = await readStore();
    store.weeks[week.id] = { ...week, source: 'excel' };
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
    week.orders = request.body.orders;
    week.updatedAt = new Date().toISOString();
    await writeStore(store);
    response.json({ orders: week.orders });
  } catch (error) { next(error); }
});

app.use(express.static(publicDirectory, { index: 'index.html', maxAge: '1h' }));
app.get('*splat', (request, response) => response.sendFile(path.join(publicDirectory, 'index.html')));

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: 'Die Datei ist größer als das erlaubte Upload-Limit.' });
  console.error(error);
  response.status(error.status || 500).json({ error: error.message || 'Interner Fehler.' });
});

app.listen(port, '0.0.0.0', () => console.log(`Zeitwerk läuft auf Port ${port}`));
