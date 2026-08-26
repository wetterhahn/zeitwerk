import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'zeitwerk-security-'));
process.env.DATA_DIR = dataDirectory;
const { app } = await import('../server.js');

const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(url, { method = 'GET', cookie = '', body, origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-Zeitwerk-Request'] = '1'; }
  if (origin) headers.Origin = origin;
  return fetch(`${baseUrl}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('protects mutations and safely deletes employees while retaining week history', async () => {
  const setup = await request('/api/setup', { method: 'POST', body: { name: 'Admin Beispiel', personnelNumber: '1', username: 'admin', password: 'ein-sehr-sicheres-passwort' } });
  assert.equal(setup.status, 201);
  const sessionCookie = setup.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => /^zeitwerk_session=[0-9a-f]+$/.test(value));
  assert.ok(sessionCookie);

  const crossSite = await request('/api/employees', { method: 'POST', cookie: sessionCookie, origin: 'https://example.invalid', body: { name: 'Nicht erlaubt', personnelNumber: '98' } });
  assert.equal(crossSite.status, 403);

  const officeAccount = await request('/api/employees', { method: 'POST', cookie: sessionCookie, body: { name: 'Büro Vollzugriff', personnelNumber: '9', loginEnabled: true, username: 'buero', password: '12345678', hiddenFromTracking: true } });
  assert.equal(officeAccount.status, 201);
  assert.equal((await officeAccount.json()).employee.hiddenFromTracking, true);
  const officeLogin = await request('/api/login', { method: 'POST', body: { username: 'buero', password: '12345678' } });
  assert.equal(officeLogin.status, 200);
  const officeCookie = officeLogin.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => /^zeitwerk_session=[0-9a-f]+$/.test(value));
  assert.ok(officeCookie);

  const created = await request('/api/employees', { method: 'POST', cookie: officeCookie, body: { name: 'Montage Beispiel', personnelNumber: '7', loginEnabled: false } });
  assert.equal(created.status, 201);
  const employee = (await created.json()).employee;

  const week = await request('/api/weeks', { method: 'POST', cookie: officeCookie, body: { year: 2026, weekNumber: 26 } });
  assert.equal(week.status, 201);
  assert.equal((await week.json()).week.employees.some((item) => item.id === '9'), false);

  const laterEmployee = await request('/api/employees', { method: 'POST', cookie: officeCookie, body: { name: 'Später angelegt', personnelNumber: '8', loginEnabled: false } });
  assert.equal(laterEmployee.status, 201);
  const synchronizedWeek = await request('/api/weeks/2026-kw-26', { cookie: officeCookie }).then((response) => response.json());
  assert.equal(synchronizedWeek.week.employees.some((item) => item.id === '8'), true);

  const orderEmployees = synchronizedWeek.week.employees.map((item) => ({ ...item, days: item.days.map((day, dayIndex) => ({ ...day, allocations: item.id === '7' && dayIndex === 0 ? [{ orderId: 'auftrag-1', hours: 8 }] : [] })) }));
  const orderUpdate = await request('/api/weeks/2026-kw-26/orders', { method: 'PUT', cookie: officeCookie, body: { orders: [{ id: 'auftrag-1', number: '10001', name: 'Testauftrag', employeeIds: ['7'], active: true }], employees: orderEmployees } });
  assert.equal(orderUpdate.status, 200);
  const orderWeek = await request('/api/weeks/2026-kw-26', { cookie: officeCookie }).then((response) => response.json());
  assert.deepEqual(orderWeek.week.orders[0].employeeIds, ['7']);
  assert.equal(orderWeek.week.employees.find((item) => item.id === '7').days[0].allocations[0].hours, 8);

  const ownDelete = await request(`/api/employees/${(await request('/api/employees', { cookie: sessionCookie }).then((response) => response.json())).employees.find((item) => item.account?.username === 'admin').id}`, { method: 'DELETE', cookie: sessionCookie, body: {} });
  assert.equal(ownDelete.status, 400);

  const deleted = await request(`/api/employees/${employee.id}`, { method: 'DELETE', cookie: sessionCookie, body: {} });
  assert.equal(deleted.status, 200);
  const employees = await request('/api/employees', { cookie: sessionCookie }).then((response) => response.json());
  assert.equal(employees.employees.some((item) => item.id === employee.id), false);
  const savedWeek = await request('/api/weeks/2026-kw-26', { cookie: sessionCookie }).then((response) => response.json());
  assert.equal(savedWeek.week.employees.some((item) => item.id === '7'), true);
});

test('returns hardened headers and generic login failures', async () => {
  const health = await request('/api/health');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  const failed = await request('/api/login', { method: 'POST', body: { username: 'unbekannt', password: 'definitiv-falsch' } });
  assert.equal(failed.status, 401);
  assert.equal((await failed.json()).error, 'Benutzername oder Passwort ist falsch.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await request('/api/login', { method: 'POST', body: { username: 'unbekannt', password: 'weiterhin-falsch' } })).status, 401);
  }
  const throttled = await request('/api/login', { method: 'POST', body: { username: 'unbekannt', password: 'noch-immer-falsch' } });
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers.get('retry-after')) > 0);
});
