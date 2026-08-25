import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importWorkbook } from './src/import-workbook.js';
import { readStore, writeStore } from './src/storage.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const uploadLimit = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 25)) * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: uploadLimit, files: 1 } });
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'");
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (request, response) => response.json({ status: 'ok' }));

app.get('/api/weeks', async (request, response, next) => {
  try {
    const store = await readStore();
    const weeks = Object.values(store.weeks).map(({ employees, orders, ...week }) => ({ ...week, employeeCount: employees.length, orderCount: orders.length }));
    weeks.sort((a, b) => b.startDate.localeCompare(a.startDate));
    response.json({ weeks });
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
    store.weeks[week.id] = week;
    await writeStore(store);
    response.status(201).json({ week, message: `KW ${week.weekNumber} wurde erfolgreich importiert.` });
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
  response.status(500).json({ error: error.message || 'Interner Fehler.' });
});

app.listen(port, '0.0.0.0', () => console.log(`Zeitwerk läuft auf Port ${port}`));
