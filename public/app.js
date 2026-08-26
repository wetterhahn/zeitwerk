const state = { weeks: [], week: null, users: [], employees: [], user: null, version: '', view: 'entry', selectedEmployeeId: null, selectedOrderId: null, dirty: false, loading: true };
const content = document.querySelector('#content');
const bootFallback = document.querySelector('#boot-fallback');
const authShell = document.querySelector('#auth-shell');
const appShell = document.querySelector('#app-shell');
const weekSelect = document.querySelector('#week-select');
const saveButton = document.querySelector('#save-button');
const exportButton = document.querySelector('#export-button');
const pageTitle = document.querySelector('#page-title');
const sectionLabel = document.querySelector('#section-label');
const notice = document.querySelector('#notice');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const formatHours = (value) => Number(value || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoursBetween = (start, end, pause = 0) => { if (!start || !end) return 0; const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); let minutes = eh * 60 + em - sh * 60 - sm; if (minutes < 0) minutes += 1440; return Math.max(0, minutes / 60 - Number(pause || 0)); };
const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const currentIsoWeek = () => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7)); const firstThursday = new Date(date.getFullYear(), 0, 4); return { year: date.getFullYear(), weekNumber: 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7) }; };
const greeting = () => { const hour = new Date().getHours(); return hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend'; };

async function api(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD'].includes(method)) headers.set('X-Zeitwerk-Request', '1');
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !['/api/login', '/api/session'].includes(url)) showAuth(false);
  if (!response.ok) throw new Error(data.error || 'Die Anfrage ist fehlgeschlagen.');
  return data;
}

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.className = error ? 'error' : 'show';
  window.setTimeout(() => { notice.className = ''; }, 3500);
}

function showAuth(setupRequired) {
  bootFallback.hidden = true;
  appShell.hidden = true;
  authShell.hidden = false;
  const setupFields = setupRequired ? `<label><span>Anzeigename</span><input name="name" autocomplete="name" required></label><label><span>Personalnummer</span><input name="personnelNumber" required></label>` : '';
  authShell.innerHTML = `<div class="auth-card card"><img class="auth-logo" src="/logo.svg" alt="gthSERVICE Zeiterfassung"><p class="eyebrow">${setupRequired ? 'Erster Start' : 'Geschützter Bereich'}</p><h1>${setupRequired ? 'Erstes Vollzugriff-Konto' : 'Willkommen zurück'}</h1><p>${setupRequired ? 'Dieses Konto richtet das System ein. Weitere Benutzer können danach angelegt werden; alle besitzen denselben Vollzugriff.' : 'Melde dich mit deinem Zeitwerk-Konto an.'}</p><form id="auth-form" class="stack-form">${setupFields}<label><span>Benutzername</span><input name="username" autocomplete="username" minlength="3" required></label><label><span>Passwort</span><input name="password" type="password" autocomplete="${setupRequired ? 'new-password' : 'current-password'}" minlength="8" required></label><p class="auth-error" id="auth-error"></p><button class="button primary" type="submit">${setupRequired ? 'System einrichten' : 'Anmelden'}</button></form></div>`;
  authShell.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const button = form.querySelector('button'); const data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    try {
      const result = await api(setupRequired ? '/api/setup' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      await enterApp(result.user);
    } catch (error) { authShell.querySelector('#auth-error').textContent = error.message; button.disabled = false; }
  });
}

async function loadUsers() {
  const [usersResult, employeesResult] = await Promise.all([api('/api/users'), api('/api/employees')]);
  state.users = usersResult.users;
  state.employees = employeesResult.employees;
}

async function enterApp(user) {
  bootFallback.hidden = true;
  state.user = user;
  authShell.hidden = true;
  appShell.hidden = false;
  document.querySelector('#account-name').textContent = user.name;
  document.querySelector('#account-avatar').textContent = initials(user.name) || 'U';
  document.querySelector('#app-version').textContent = `v${state.version}`;
  await loadUsers();
  await loadWeeks();
}

function markDirty() { state.dirty = true; saveButton.textContent = 'Änderungen speichern'; saveButton.disabled = false; }
function orderById(id) { return state.week?.orders.find((order) => order.id === id); }
function employeeStats(employee) { const totals = employee.days.map((day) => hoursBetween(day.start, day.end, day.pause)); const total = totals.reduce((sum, value) => sum + value, 0); const allocated = employee.days.flatMap((day) => day.allocations).reduce((sum, item) => sum + Number(item.hours || 0), 0); return { totals, total, allocated, difference: total - allocated }; }
function dateForDay(index) { const date = new Date(`${state.week.startDate}T12:00:00`); date.setDate(date.getDate() + index); return date; }

async function loadWeeks(preferredId) {
  const { weeks } = await api('/api/weeks');
  state.weeks = weeks;
  const id = preferredId || state.week?.id || weeks[0]?.id;
  if (id) { const result = await api(`/api/weeks/${encodeURIComponent(id)}`); state.week = result.week; state.selectedEmployeeId = state.week.employees.some((employee) => String(employee.id) === String(state.selectedEmployeeId)) ? state.selectedEmployeeId : state.week.employees[0]?.id; state.selectedOrderId = state.week.orders.some((order) => order.id === state.selectedOrderId) ? state.selectedOrderId : state.week.orders[0]?.id; }
  else { state.week = null; state.view = 'weeks'; }
  state.loading = false; state.dirty = false; render();
}

function renderHeader() {
  const titles = { entry: ['Zeiterfassung', `${greeting()}, ${state.user?.name || ''}!`], overview: ['Auswertung', 'Wochenübersicht'], orders: ['Wochenplanung', 'Aufträge & Stunden'], weeks: ['Planung', 'Kalenderwochen'], users: ['Verwaltung', 'Mitarbeiter'], import: ['Optionale Datenübernahme', 'Excel-Datei importieren'] };
  [sectionLabel.textContent, pageTitle.textContent] = titles[state.view];
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  weekSelect.innerHTML = state.weeks.length ? state.weeks.map((week) => `<option value="${escapeHtml(week.id)}" ${state.week?.id === week.id ? 'selected' : ''}>KW ${week.weekNumber} · ${escapeHtml(week.startDate)} bis ${escapeHtml(week.endDate)}</option>`).join('') : '<option>Noch keine Woche</option>';
  weekSelect.disabled = !state.weeks.length;
  saveButton.hidden = !['entry', 'orders'].includes(state.view) || !state.week;
  exportButton.hidden = !['entry', 'overview', 'orders'].includes(state.view) || !state.week;
  saveButton.textContent = state.dirty ? 'Änderungen speichern' : 'Gespeichert';
  saveButton.disabled = !state.dirty;
}

function renderEmpty() { return `<section class="page empty-page"><div class="empty-card card"><div class="empty-icon">＋</div><h2>Noch keine Kalenderwoche vorhanden</h2><p>Lege eine Woche direkt in der Website an und starte sofort. Wenn bereits eine ausgefüllte Excel-Datei existiert, kann sie alternativ importiert werden.</p><div class="empty-actions"><button class="button primary" data-action="go-weeks">Woche anlegen</button><button class="button secondary" data-action="go-import">Excel optional importieren</button></div></div></section>`; }

function renderEntry() {
  if (!state.week) return renderEmpty();
  const employee = state.week.employees.find((item) => String(item.id) === String(state.selectedEmployeeId)) || state.week.employees[0];
  const stats = employeeStats(employee); const activeOrders = state.week.orders.filter((order) => order.active);
  const people = state.week.employees.map((item) => `<button class="person ${String(item.id) === String(employee.id) ? 'active' : ''}" data-employee="${escapeHtml(item.id)}"><span class="avatar">${escapeHtml(initials(item.name))}</span><span><b>${escapeHtml(item.name)}</b><small>Personal-Nr. ${escapeHtml(item.id)}</small></span><i>›</i></button>`).join('');
  const days = employee.days.map((day, index) => { const total = stats.totals[index]; const assigned = day.allocations.reduce((sum, item) => sum + Number(item.hours || 0), 0); const date = dateForDay(index); const allocations = day.allocations.map((item, allocationIndex) => { const order = orderById(item.orderId); return `<div class="allocation" data-day="${index}" data-allocation="${allocationIndex}"><span class="number">${escapeHtml(order?.number || '—')}</span><select data-field="orderId">${state.week.orders.map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === item.orderId ? 'selected' : ''} ${!candidate.active ? 'disabled' : ''}>${escapeHtml(candidate.number)} · ${escapeHtml(candidate.name)}${!candidate.active ? ' (inaktiv)' : ''}</option>`).join('')}</select><input data-field="hours" type="number" min="0" step="0.25" value="${escapeHtml(item.hours)}" aria-label="Auftragsstunden"><span>Std.</span><button class="icon-button" data-action="remove-allocation" aria-label="Zuordnung entfernen">×</button></div>`; }).join(''); return `<article class="day-card card" data-day="${index}"><div class="day-head"><div class="date-box"><strong>${date.getDate()}</strong><span>${date.toLocaleDateString('de-DE', { month: 'short' })}</span></div><div><h3>${dayNames[index]}</h3><p>${total ? `${formatHours(total)} Netto-Stunden` : 'Noch keine Zeit erfasst'}</p></div></div><div class="time-grid"><label class="field"><span>Von</span><input data-field="start" type="time" value="${escapeHtml(day.start)}"></label><label class="field"><span>Bis</span><input data-field="end" type="time" value="${escapeHtml(day.end)}"></label><label class="field"><span>Pause</span><select data-field="pause">${[[0,'Keine'],[.25,'15 Min.'],[.5,'30 Min.'],[.75,'45 Min.'],[1,'60 Min.']].map(([value,label]) => `<option value="${value}" ${Number(day.pause) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="net"><span>Netto</span><strong>${formatHours(total)} Std.</strong></div></div><div class="allocation-box"><div class="allocation-title"><span>Auf Aufträge verteilen</span><span>${formatHours(assigned)} von ${formatHours(total)} Std.</span></div>${allocations}${activeOrders.length ? '<button class="link-button" data-action="add-allocation">＋ Weiterer Auftrag</button>' : '<div class="no-orders">Für diese Woche ist kein aktiver Auftrag vorhanden.</div>'}</div></article>`; }).join('');
  return `<section class="page"><div class="entry-layout"><aside class="people-card card"><div class="panel-title"><div><p class="eyebrow">Team</p><h2>Mitarbeiter</h2></div><span class="count">${state.week.employees.length}</span></div><div class="people-list">${people}</div></aside><section><div class="employee-heading"><span class="avatar">${escapeHtml(initials(employee.name))}</span><div><p class="eyebrow">Aktive Erfassung</p><h2>${escapeHtml(employee.name)}</h2></div><span class="balance ${Math.abs(stats.difference) < .01 ? 'ok' : ''}">${Math.abs(stats.difference) < .01 ? 'Vollständig' : `${formatHours(Math.abs(stats.difference))} Std. offen`}</span></div><div class="day-list">${days}</div></section><aside class="summary-column"><div class="summary card"><p class="eyebrow">Wochensumme</p><strong class="big">${formatHours(stats.total)}</strong><span>Netto-Stunden</span><div class="rule"></div><dl><div><dt>Zugeordnet</dt><dd>${formatHours(stats.allocated)} Std.</dd></div><div><dt>Differenz</dt><dd>${formatHours(stats.difference)} Std.</dd></div></dl></div><div class="check ${Math.abs(stats.difference) < .01 ? 'ok' : ''}">${Math.abs(stats.difference) < .01 ? '✓ Arbeitszeit und Aufträge stimmen überein.' : '! Bitte die Auftragszuordnung prüfen.'}</div></aside></div></section>`;
}

function renderOverview() {
  if (!state.week) return renderEmpty();
  const allStats = state.week.employees.map(employeeStats); const total = allStats.reduce((sum, item) => sum + item.total, 0); const allocated = allStats.reduce((sum, item) => sum + item.allocated, 0); const complete = allStats.filter((item) => Math.abs(item.difference) < .01).length;
  const rows = state.week.employees.map((employee, employeeIndex) => { const stats = allStats[employeeIndex]; return `<button class="overview-row person-row" data-employee="${escapeHtml(employee.id)}"><span class="overview-name"><i class="avatar">${escapeHtml(initials(employee.name))}</i><b>${escapeHtml(employee.name)}<small>Nr. ${escapeHtml(employee.id)}</small></b></span>${stats.totals.map((value) => `<span>${formatHours(value)}</span>`).join('')}<strong>${formatHours(stats.total)}</strong><span>${formatHours(stats.allocated)}</span><span class="pill ${Math.abs(stats.difference) < .01 ? 'ok' : ''}">${Math.abs(stats.difference) < .01 ? 'Fertig' : `${formatHours(Math.abs(stats.difference))} offen`}</span></button>`; }).join('');
  return `<section class="page"><div class="kpis"><div class="kpi card"><span>Teamstunden</span><strong>${formatHours(total)}</strong></div><div class="kpi card"><span>Zugeordnet</span><strong>${formatHours(allocated)}</strong></div><div class="kpi card"><span>Vollständig</span><strong>${complete} / ${state.week.employees.length}</strong></div></div><div class="table-card card"><div class="overview-row head"><span>Mitarbeiter</span>${dayNames.map((day) => `<span>${day.slice(0,2)}</span>`).join('')}<span>Woche</span><span>Aufträge</span><span>Status</span></div>${rows}</div></section>`;
}

function orderHours(orderId) { return state.week.employees.reduce((sum, employee) => sum + employee.days.flatMap((day) => day.allocations).filter((item) => item.orderId === orderId).reduce((part, item) => part + Number(item.hours || 0), 0), 0); }
function orderDayHours(employee, dayIndex, orderId) { return employee.days[dayIndex].allocations.filter((item) => item.orderId === orderId).reduce((sum, item) => sum + Number(item.hours || 0), 0); }
function setOrderDayHours(employeeId, dayIndex, orderId, hours) { const employee = state.week.employees.find((item) => String(item.id) === String(employeeId)); if (!employee) return; employee.days[dayIndex].allocations = employee.days[dayIndex].allocations.filter((item) => item.orderId !== orderId); if (hours > 0) employee.days[dayIndex].allocations.push({ orderId, hours }); }
function renderOrders() {
  if (!state.week) return renderEmpty();
  const order = state.week.orders.find((item) => item.id === state.selectedOrderId) || state.week.orders[0];
  const orderButtons = state.week.orders.map((item) => `<button class="order-nav-item ${item.id === order?.id ? 'active' : ''} ${item.active ? '' : 'inactive'}" data-select-order="${escapeHtml(item.id)}"><span>${escapeHtml(item.number)}</span><b>${escapeHtml(item.name)}</b><small>${formatHours(orderHours(item.id))} Std.</small></button>`).join('');
  const employeeRows = order ? state.week.employees.map((employee) => `<div class="order-hours-row"><span class="order-employee"><i class="avatar">${escapeHtml(initials(employee.name))}</i><b>${escapeHtml(employee.name)}<small>Nr. ${escapeHtml(employee.id)}</small></b></span>${dayNames.map((day, dayIndex) => `<label><span>${day.slice(0, 2)}</span><input class="order-hours-input" data-employee-id="${escapeHtml(employee.id)}" data-day-index="${dayIndex}" type="number" min="0" step="0.25" value="${escapeHtml(orderDayHours(employee, dayIndex, order.id) || '')}" aria-label="${escapeHtml(employee.name)} ${day} Stunden"></label>`).join('')}<strong>${formatHours(employee.days.reduce((sum, day, dayIndex) => sum + orderDayHours(employee, dayIndex, order.id), 0))}</strong></div>`).join('') : '';
  const detail = order ? `<div class="order-detail"><form id="order-detail-form" class="order-detail-form" data-order-id="${escapeHtml(order.id)}"><div class="order-detail-head"><div><p class="eyebrow">Auftragsdaten</p><h2>${escapeHtml(order.number)} · ${escapeHtml(order.name)}</h2></div><label class="switch"><input name="active" type="checkbox" ${order.active ? 'checked' : ''}><span>Aktiv</span></label></div><div class="order-fields"><label><span>Auftragsnummer *</span><input name="number" required value="${escapeHtml(order.number)}"></label><label><span>Bezeichnung *</span><input name="name" required value="${escapeHtml(order.name)}"></label><label><span>Anforderer</span><input name="requester" value="${escapeHtml(order.requester || '')}"></label><label class="description-field"><span>Beschreibung / Bemerkung</span><textarea name="description" rows="4" placeholder="Arbeiten, Hinweise und weitere Details">${escapeHtml(order.description || '')}</textarea></label></div></form><div class="hours-matrix card"><div class="matrix-title"><div><p class="eyebrow">Wie im Excel-Auftragsblatt</p><h3>Mitarbeiterstunden</h3></div><strong>${formatHours(orderHours(order.id))} Std. gesamt</strong></div><div class="order-hours-row matrix-head"><span>Mitarbeiter</span>${dayNames.map((day) => `<span>${day.slice(0, 2)}</span>`).join('')}<span>Summe</span></div>${employeeRows}</div></div>` : '<div class="empty-card card"><p>Lege links zuerst einen Auftrag an.</p></div>';
  return `<section class="page"><div class="orders-workspace"><aside class="order-sidebar"><div class="order-create card"><p class="eyebrow">KW ${state.week.weekNumber}</p><h2>Neuer Auftrag</h2><form id="order-form" class="order-form"><label><span>Auftragsnummer *</span><input name="number" required placeholder="z. B. 10001"></label><label><span>Bezeichnung *</span><input name="name" required placeholder="z. B. Wartungsauftrag"></label><label><span>Anforderer</span><input name="requester" placeholder="Optional"></label><label><span>Beschreibung</span><textarea name="description" rows="3" placeholder="Was wurde ausgeführt?"></textarea></label><button class="button primary" type="submit">Auftrag anlegen</button></form></div><div class="order-navigation"><p class="eyebrow">${state.week.orders.length} Aufträge</p>${orderButtons || '<p class="muted-copy">Noch keine Aufträge vorhanden.</p>'}</div></aside>${detail}</div></section>`;
}

function renderWeeks() {
  const current = currentIsoWeek();
  const weeks = state.weeks.map((week) => `<article class="week-card card"><span class="week-badge">KW ${week.weekNumber}</span><div><h3>${escapeHtml(week.startDate)} bis ${escapeHtml(week.endDate)}</h3><p>${week.employeeCount} Mitarbeiter · ${week.orderCount} Aufträge</p></div><span class="source-tag ${week.source === 'manual' ? 'manual' : ''}">${week.source === 'manual' ? 'Manuell' : 'Excel'}</span></article>`).join('');
  return `<section class="page"><div class="management-layout"><div class="management-create card"><p class="eyebrow">Ohne Excel starten</p><h2>Kalenderwoche anlegen</h2><p>Alle aktiven Mitarbeiter werden automatisch in die neue Woche übernommen. Aufträge werden anschließend passend für diese Woche angelegt.</p><form id="week-form" class="stack-form"><label><span>Jahr</span><input name="year" type="number" min="2020" max="2100" value="${current.year}" required></label><label><span>Kalenderwoche</span><input name="weekNumber" type="number" min="1" max="53" value="${current.weekNumber}" required></label><button class="button primary" type="submit">Woche anlegen</button></form><div class="info-strip"><strong>Excel ist optional.</strong><br>Eine bestehende Wochenmappe kann weiterhin über „Excel-Import“ übernommen werden.</div></div><div class="management-list"><p class="eyebrow">Vorhandene Wochen</p><h2>${state.weeks.length} Kalenderwochen</h2><div class="week-list">${weeks || '<div class="empty-card card"><p>Noch keine Woche vorhanden.</p></div>'}</div></div></div></section>`;
}

function renderPeople() {
  const employeeCards = state.employees.map((employee) => { const account = employee.account; return `<article class="user-card card ${employee.active ? '' : 'inactive'}"><div class="user-head"><span class="avatar">${escapeHtml(initials(employee.name))}</span><div><h3>${escapeHtml(employee.name)}</h3><p>Personal-Nr. ${escapeHtml(employee.personnelNumber)}${account ? ` · @${escapeHtml(account.username)}` : ''}</p></div><span class="role-tag">${account ? 'Mit Anmeldung' : 'Ohne Anmeldung'}</span></div><form class="employee-edit employee-unified-form" data-employee-id="${escapeHtml(employee.id)}"><label><span>Name</span><input name="name" value="${escapeHtml(employee.name)}" required></label><label><span>Personal-Nr.</span><input name="personnelNumber" value="${escapeHtml(employee.personnelNumber)}" required></label><label class="switch login-toggle"><input name="loginEnabled" type="checkbox" ${account ? 'checked' : ''} ${account?.id === state.user.id ? 'disabled' : ''}><span>Anmeldung mit Passwort</span></label><div class="login-fields" ${account ? '' : 'hidden'}><label><span>Benutzername</span><input name="username" minlength="3" value="${escapeHtml(account?.username || '')}" ${account ? 'required' : ''}></label><label><span>${account ? 'Neues Passwort' : 'Passwort'}</span><input name="password" type="password" minlength="8" placeholder="${account ? 'Unverändert' : 'Mindestens 8 Zeichen'}"></label></div><label class="switch"><input name="active" type="checkbox" ${employee.active ? 'checked' : ''}><span>Aktiv</span></label><button class="button secondary" type="submit">Speichern</button></form></article>`; }).join('');
  return `<section class="page people-admin"><div class="management-layout"><div class="management-create card"><p class="eyebrow">Standard: ohne Anmeldung</p><h2>Mitarbeiter anlegen</h2><p>Alle Personen werden hier angelegt. Nur wenn der Haken gesetzt wird, sind zusätzlich Benutzername und Passwort erforderlich.</p><form id="employee-form" class="stack-form"><label><span>Name</span><input name="name" required></label><label><span>Personalnummer</span><input name="personnelNumber" required></label><label class="switch login-toggle"><input name="loginEnabled" type="checkbox"><span>Anmeldung mit Passwort</span></label><div class="login-fields" hidden><label><span>Benutzername</span><input name="username" minlength="3"></label><label><span>Passwort</span><input name="password" type="password" minlength="8"></label></div><button class="button primary" type="submit">Mitarbeiter anlegen</button></form></div><div class="management-list"><p class="eyebrow">Eine gemeinsame Liste</p><h2>${state.employees.length} Mitarbeiter</h2><div class="user-list">${employeeCards || '<div class="empty-card card"><p>Noch keine Mitarbeiter vorhanden.</p></div>'}</div></div></div></section>`;
}

function renderImport() {
  return `<section class="page"><div class="import-layout"><div class="upload-card card"><p class="eyebrow">Optionaler Schnellstart</p><h2>Ausgefüllte Wochenmappe importieren</h2><p>Der Import ist nicht erforderlich. Neue Wochen können vollständig in der Website angelegt und gepflegt werden.</p><label class="drop-zone" id="drop-zone"><input id="file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><span class="upload-icon">⇧</span><strong>Datei auswählen oder hier ablegen</strong><span>Maximal 25 MB · nur XLSX</span></label><p class="file-name" id="file-name"></p><button id="import-button" class="button primary" disabled>Kalenderwoche importieren</button></div><div class="import-info card"><p class="eyebrow">Automatische Erkennung</p><h2>Was wird übernommen?</h2><ol><li>Kalenderwoche und Datumsbereich</li><li>Personalnummern und Namen aus dem Anwesenheitsblatt</li><li>Arbeitsbeginn, Arbeitsende und Pausen</li><li>Auftragsnummern, Bezeichnungen und Anforderer</li><li>Stundenverteilung aus den Auftragsblättern</li></ol><div class="privacy-box"><strong>Datenschutz:</strong> Die Datei wird direkt an deine eigene Instanz gesendet. Sie wird nicht dauerhaft als Datei gespeichert; nur die ausgelesenen Daten landen im Docker-Volume.</div></div></div></section>`;
}

function render() {
  renderHeader();
  if (state.loading) { content.innerHTML = '<div class="loading">Daten werden geladen …</div>'; return; }
  const views = { entry: renderEntry, overview: renderOverview, orders: renderOrders, weeks: renderWeeks, users: renderPeople, import: renderImport };
  content.innerHTML = (views[state.view] || renderEntry)();
  bindContentEvents();
}

function currentEmployee() { return state.week?.employees.find((employee) => String(employee.id) === String(state.selectedEmployeeId)); }
async function saveCurrent() {
  if (!state.week || !state.dirty) return;
  if (state.view === 'orders') await api(`/api/weeks/${encodeURIComponent(state.week.id)}/orders`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders: state.week.orders, employees: state.week.employees }) });
  else { const employee = currentEmployee(); if (employee) await api(`/api/weeks/${encodeURIComponent(state.week.id)}/employees/${encodeURIComponent(employee.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: employee.days }) }); }
  state.dirty = false; renderHeader(); showNotice('Änderungen wurden gespeichert.');
}

function bindContentEvents() {
  content.querySelector('[data-action="go-import"]')?.addEventListener('click', () => { state.view = 'import'; render(); });
  content.querySelector('[data-action="go-weeks"]')?.addEventListener('click', () => { state.view = 'weeks'; render(); });
  content.querySelectorAll('.login-toggle input').forEach((checkbox) => checkbox.addEventListener('change', () => { const fields = checkbox.closest('form').querySelector('.login-fields'); fields.hidden = !checkbox.checked; const username = fields.querySelector('[name="username"]'); const password = fields.querySelector('[name="password"]'); username.required = checkbox.checked; password.required = checkbox.checked && !password.placeholder.includes('Unverändert'); }));
  content.querySelector('#employee-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.loginEnabled = form.elements.loginEnabled.checked; const button = form.querySelector('button'); button.disabled = true;
    try { await api('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); await loadUsers(); showNotice(data.loginEnabled ? 'Mitarbeiter und Anmeldung wurden angelegt.' : 'Mitarbeiter wurde ohne Anmeldung angelegt.'); render(); }
    catch (error) { showNotice(error.message, true); button.disabled = false; }
  });
  content.querySelectorAll('.employee-edit').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(form)); data.active = form.elements.active.checked; data.loginEnabled = form.elements.loginEnabled.checked; const button = form.querySelector('button'); button.disabled = true;
    try { await api(`/api/employees/${encodeURIComponent(form.dataset.employeeId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); await loadUsers(); showNotice('Mitarbeiter wurde aktualisiert.'); render(); }
    catch (error) { showNotice(error.message, true); button.disabled = false; }
  }));
  content.querySelector('#week-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const button = form.querySelector('button'); button.disabled = true;
    try { const result = await api('/api/weeks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); await loadWeeks(result.week.id); state.view = 'entry'; showNotice(result.message); render(); }
    catch (error) { showNotice(error.message, true); button.disabled = false; }
  });
  content.querySelectorAll('[data-employee]').forEach((button) => button.addEventListener('click', async () => { try { await saveCurrent(); state.selectedEmployeeId = button.dataset.employee; state.view = button.classList.contains('person-row') ? 'entry' : state.view; render(); } catch (error) { showNotice(error.message, true); } }));
  content.querySelectorAll('.day-card').forEach((card) => { const dayIndex = Number(card.dataset.day); card.querySelectorAll('.time-grid [data-field]').forEach((input) => input.addEventListener('change', () => { const field = input.dataset.field; currentEmployee().days[dayIndex][field] = field === 'pause' ? Number(input.value) : input.value; markDirty(); render(); })); card.querySelectorAll('.allocation').forEach((row) => { const allocationIndex = Number(row.dataset.allocation); row.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('change', () => { const field = input.dataset.field; currentEmployee().days[dayIndex].allocations[allocationIndex][field] = field === 'hours' ? Number(input.value) : input.value; markDirty(); render(); })); row.querySelector('[data-action="remove-allocation"]')?.addEventListener('click', () => { currentEmployee().days[dayIndex].allocations.splice(allocationIndex, 1); markDirty(); render(); }); }); card.querySelector('[data-action="add-allocation"]')?.addEventListener('click', () => { const order = state.week.orders.find((item) => item.active); if (order) currentEmployee().days[dayIndex].allocations.push({ orderId: order.id, hours: 0 }); markDirty(); render(); }); });
  const orderForm = content.querySelector('#order-form'); orderForm?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(orderForm); const order = { id: `manuell-${Date.now()}`, number: String(data.get('number')).trim(), name: String(data.get('name')).trim(), requester: String(data.get('requester')).trim(), description: String(data.get('description')).trim(), active: true }; state.week.orders.push(order); state.selectedOrderId = order.id; markDirty(); render(); });
  content.querySelectorAll('[data-select-order]').forEach((button) => button.addEventListener('click', () => { state.selectedOrderId = button.dataset.selectOrder; render(); }));
  const orderDetailForm = content.querySelector('#order-detail-form'); orderDetailForm?.querySelectorAll('input, textarea').forEach((input) => input.addEventListener('change', () => { const order = orderById(orderDetailForm.dataset.orderId); if (!order) return; order[input.name] = input.name === 'active' ? input.checked : input.value; markDirty(); }));
  content.querySelectorAll('.order-hours-input').forEach((input) => input.addEventListener('change', () => { setOrderDayHours(input.dataset.employeeId, Number(input.dataset.dayIndex), state.selectedOrderId, Math.max(0, Number(input.value || 0))); markDirty(); render(); }));
  const fileInput = content.querySelector('#file-input'); const dropZone = content.querySelector('#drop-zone'); const importButton = content.querySelector('#import-button'); let selectedFile;
  const chooseFile = (file) => { selectedFile = file; const valid = file?.name.toLowerCase().endsWith('.xlsx'); content.querySelector('#file-name').textContent = valid ? file.name : 'Bitte eine XLSX-Datei auswählen.'; importButton.disabled = !valid; };
  fileInput?.addEventListener('change', () => chooseFile(fileInput.files[0]));
  dropZone?.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('drag'); }); dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag')); dropZone?.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('drag'); chooseFile(event.dataTransfer.files[0]); });
  importButton?.addEventListener('click', async () => { if (!selectedFile) return; importButton.disabled = true; importButton.textContent = 'Import läuft …'; try { const body = new FormData(); body.append('file', selectedFile); const result = await api('/api/import', { method: 'POST', body }); await loadWeeks(result.week.id); state.view = 'overview'; showNotice(result.message); render(); } catch (error) { showNotice(error.message, true); importButton.disabled = false; importButton.textContent = 'Kalenderwoche importieren'; } });
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', async () => { try { await saveCurrent(); state.view = button.dataset.view; render(); } catch (error) { showNotice(error.message, true); } }));
weekSelect.addEventListener('change', async () => { try { await saveCurrent(); await loadWeeks(weekSelect.value); } catch (error) { showNotice(error.message, true); } });
saveButton.addEventListener('click', () => saveCurrent().catch((error) => showNotice(error.message, true)));
exportButton.addEventListener('click', () => { if (!state.week) return; const rows = [['Personal-Nr.','Mitarbeiter','Tag','Datum','Von','Bis','Pause','Netto','Auftragsnummer','Auftrag','Auftragsstunden']]; state.week.employees.forEach((employee) => { const stats = employeeStats(employee); employee.days.forEach((day, index) => { const allocations = day.allocations.length ? day.allocations : [{ orderId: '', hours: 0 }]; allocations.forEach((item) => { const order = orderById(item.orderId); rows.push([employee.id,employee.name,dayNames[index],dateForDay(index).toLocaleDateString('de-DE'),day.start,day.end,String(day.pause).replace('.',','),formatHours(stats.totals[index]),order?.number || '',order?.name || '',formatHours(item.hours)]); }); }); }); const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"','""')}"`).join(';')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })); link.download = `Zeitwerk_KW${state.week.weekNumber}.csv`; link.click(); URL.revokeObjectURL(link.href); });

document.querySelector('#logout-button').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); state.user = null; state.week = null; showAuth(false); } catch (error) { showNotice(error.message, true); } });

async function bootstrap() {
  try {
    const [health, session] = await Promise.all([api('/api/health'), api('/api/session')]);
    state.version = health.version;
    if (session.setupRequired) return showAuth(true);
    if (!session.authenticated) return showAuth(false);
    await enterApp(session.user);
  } catch (error) { bootFallback.querySelector('strong').textContent = 'Verbindung fehlgeschlagen'; bootFallback.querySelector('span').textContent = error.message; }
}

bootstrap();

