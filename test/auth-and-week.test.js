import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { passwordMatches, passwordNeedsUpgrade, passwordRecord, publicUser, validateCredentials } from '../src/auth.js';
import { createManualWeek } from '../src/week.js';

test('hashes passwords and never exposes password data', async () => {
  const record = await passwordRecord('12345678');
  const user = { id: 'u1', username: 'beispiel', name: 'Beispiel', personnelNumber: '101', active: true, createdAt: '2026-01-01', ...record };
  assert.equal(await passwordMatches('12345678', user), true);
  assert.equal(await passwordMatches('falsch', user), false);
  assert.equal(record.passwordN, 2 ** 17);
  assert.equal(passwordNeedsUpgrade(user), false);
  assert.equal('passwordHash' in publicUser(user), false);
  assert.equal(publicUser(user).role, 'Vollzugriff');
});

test('allows eight-character passwords in the browser login form', () => {
  const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /autocomplete="\$\{setupRequired \? 'new-password' : 'current-password'\}" minlength="8"/);
  assert.doesNotMatch(appSource, /minlength="15"/);
  assert.match(appSource, /name="hiddenFromTracking"/);
  assert.match(appSource, /id="add-order-employee"/);
  assert.match(appSource, /function visibleWeekEmployees\(\)/);
});

test('normalizes and validates account fields', () => {
  const result = validateCredentials({ username: '  Test.User ', name: 'Beispiel', personnelNumber: ' 101 ', password: '12345678' });
  assert.equal(result.username, 'test.user');
  assert.equal(result.personnelNumber, '101');
  assert.throws(() => validateCredentials({ username: 'test.user', name: 'Beispiel', personnelNumber: '101', password: '1234567' }), /8 Zeichen/);
});

test('creates a manual week from active employees without accounts', () => {
  const week = createManualWeek({ year: 2026, weekNumber: 25, employees: [
    { name: 'Beispiel Eins', personnelNumber: '101', active: true },
    { name: 'Beispiel Zwei', personnelNumber: '102', active: false },
    { name: 'Verwaltung', personnelNumber: '103', active: true, hiddenFromTracking: true }
  ] });
  assert.equal(week.id, '2026-kw-25');
  assert.equal(week.startDate, '2026-06-15');
  assert.equal(week.endDate, '2026-06-19');
  assert.equal(week.employees.length, 1);
  assert.equal(week.employees[0].days.length, 5);
  assert.equal(week.employees.some((employee) => employee.id === '103'), false);
  assert.equal(week.source, 'manual');
});
