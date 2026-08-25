const state = { weeks: [], week: null, view: 'entry', selectedEmployeeId: null, dirty: false, loading: true };
const content = document.querySelector('#content');
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

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Die Anfrage ist fehlgeschlagen.');
  return data;
}

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.className = error ? 'error' : 'show';
  window.setTimeout(() => { notice.className = ''; }, 3500);
}

function markDirty() { state.dirty = true; saveButton.textContent = 'Änderungen speichern'; saveButton.disabled = false; }
function orderById(id) { return state.week?.orders.find((order) => order.id === id); }
function employeeStats(employee) { const totals = employee.days.map((day) => hoursBetween(day.start, day.end, day.pause)); const total = totals.reduce((sum, value) => sum + value, 0); const allocated = employee.days.flatMap((day) => day.allocations).reduce((sum, item) => sum + Number(item.hours || 0), 0); return { totals, total, allocated, difference: total - allocated }; }
function dateForDay(index) { const date = new Date(`${state.week.startDate}T12:00:00`); date.setDate(date.getDate() + index); return date; }

async function loadWeeks(preferredId) {
  const { weeks } = await api('/api/weeks');
  state.weeks = weeks;
  const id = preferredId || state.week?.id || weeks[0]?.id;
  if (id) { const result = await api(`/api/weeks/${encodeURIComponent(id)}`); state.week = result.week; state.selectedEmployeeId = state.week.employees.some((employee) => String(employee.id) === String(state.selectedEmployeeId)) ? state.selectedEmployeeId : state.week.employees[0]?.id; }
  else { state.week = null; state.view = 'import'; }
  state.loading = false; state.dirty = false; render();
}

function renderHeader() {
  const titles = { entry: ['Zeiterfassung', 'Wochenstunden erfassen'], overview: ['Auswertung', 'Wochenübersicht'], orders: ['Wochenplanung', 'Aufträge verwalten'], import: ['Datenübernahme', 'Excel-Datei importieren'] };
  [sectionLabel.textContent, pageTitle.textContent] = titles[state.view];
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  weekSelect.innerHTML = state.weeks.length ? state.weeks.map((week) => `<option value="${escapeHtml(week.id)}" ${state.week?.id === week.id ? 'selected' : ''}>KW ${week.weekNumber} · ${escapeHtml(week.startDate)} bis ${escapeHtml(week.endDate)}</option>`).join('') : '<option>Keine Woche importiert</option>';
  weekSelect.disabled = !state.weeks.length;
  saveButton.hidden = state.view === 'import' || !state.week;
  exportButton.hidden = state.view === 'import' || !state.week;
  saveButton.textContent = state.dirty ? 'Änderungen speichern' : 'Gespeichert';
  saveButton.disabled = !state.dirty;
}

function renderEmpty() { return `<section class="page empty-page"><div class="empty-card card"><div class="empty-icon">⇧</div><h2>Noch keine Kalenderwoche vorhanden</h2><p>Importiere deine ausgefüllte Excel-Datei. Mitarbeiter, Aufträge und Zeitdaten werden ausschließlich daraus übernommen.</p><button class="button primary" data-action="go-import">Excel-Datei importieren</button></div></section>`; }

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
function renderOrders() {
  if (!state.week) return renderEmpty();
  const orders = state.week.orders.map((order, index) => `<article class="order-card card ${order.active ? '' : 'inactive'}" data-order="${index}"><span class="order-id">${escapeHtml(order.number)}</span><div class="order-info"><h3>${escapeHtml(order.name)}</h3><p>${order.requester ? `Anforderer: ${escapeHtml(order.requester)}` : 'Kein Anforderer eingetragen'}</p></div><div class="order-hours"><strong>${formatHours(orderHours(order.id))}</strong><span>Std. erfasst</span></div><label class="switch"><input data-field="active" type="checkbox" ${order.active ? 'checked' : ''}><span>${order.active ? 'Aktiv' : 'Inaktiv'}</span></label></article>`).join('');
  return `<section class="page"><div class="orders-grid"><div class="order-create card"><p class="eyebrow">Neuer Wochenauftrag</p><h2>Auftrag anlegen</h2><p>Der Auftrag wird nur der importierten KW ${state.week.weekNumber} hinzugefügt.</p><form id="order-form" class="order-form"><label><span>Auftragsnummer *</span><input name="number" required placeholder="z. B. 10001"></label><label><span>Bezeichnung *</span><input name="name" required placeholder="z. B. Wartungsauftrag"></label><label><span>Anforderer</span><input name="requester" placeholder="Optional"></label><button class="button primary" type="submit">Auftrag hinzufügen</button></form></div><div class="orders-list"><p class="eyebrow">Auftragsliste</p><h2>${state.week.orders.length} Aufträge in KW ${state.week.weekNumber}</h2><div class="order-list-items">${orders || '<div class="empty-card card"><p>Noch keine Aufträge vorhanden.</p></div>'}</div></div></div></section>`;
}

function renderImport() {
  return `<section class="page"><div class="import-layout"><div class="upload-card card"><p class="eyebrow">Excel übernehmen</p><h2>Ausgefüllte Wochenmappe importieren</h2><p>Unterstützt wird die bestehende XLSX-Struktur mit „Anwesenheit“ und den einzelnen Auftragsblättern.</p><label class="drop-zone" id="drop-zone"><input id="file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><span class="upload-icon">⇧</span><strong>Datei auswählen oder hier ablegen</strong><span>Maximal 25 MB · nur XLSX</span></label><p class="file-name" id="file-name"></p><button id="import-button" class="button primary" disabled>Kalenderwoche importieren</button></div><div class="import-info card"><p class="eyebrow">Automatische Erkennung</p><h2>Was wird übernommen?</h2><ol><li>Kalenderwoche und Datumsbereich</li><li>Personalnummern und Namen aus dem Anwesenheitsblatt</li><li>Arbeitsbeginn, Arbeitsende und Pausen</li><li>Auftragsnummern, Bezeichnungen und Anforderer</li><li>Stundenverteilung aus den Auftragsblättern</li></ol><div class="privacy-box"><strong>Datenschutz:</strong> Die Datei wird direkt an deine eigene Zeitwerk-Instanz gesendet. Sie wird nicht dauerhaft als Datei gespeichert; nur die ausgelesenen Daten landen im Docker-Volume.</div></div></div></section>`;
}

function render() {
  renderHeader();
  if (state.loading) { content.innerHTML = '<div class="loading">Daten werden geladen …</div>'; return; }
  content.innerHTML = state.view === 'entry' ? renderEntry() : state.view === 'overview' ? renderOverview() : state.view === 'orders' ? renderOrders() : renderImport();
  bindContentEvents();
}

function currentEmployee() { return state.week?.employees.find((employee) => String(employee.id) === String(state.selectedEmployeeId)); }
async function saveCurrent() {
  if (!state.week || !state.dirty) return;
  if (state.view === 'orders') await api(`/api/weeks/${encodeURIComponent(state.week.id)}/orders`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders: state.week.orders }) });
  else { const employee = currentEmployee(); if (employee) await api(`/api/weeks/${encodeURIComponent(state.week.id)}/employees/${encodeURIComponent(employee.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: employee.days }) }); }
  state.dirty = false; renderHeader(); showNotice('Änderungen wurden gespeichert.');
}

function bindContentEvents() {
  content.querySelector('[data-action="go-import"]')?.addEventListener('click', () => { state.view = 'import'; render(); });
  content.querySelectorAll('[data-employee]').forEach((button) => button.addEventListener('click', async () => { try { await saveCurrent(); state.selectedEmployeeId = button.dataset.employee; state.view = button.classList.contains('person-row') ? 'entry' : state.view; render(); } catch (error) { showNotice(error.message, true); } }));
  content.querySelectorAll('.day-card').forEach((card) => { const dayIndex = Number(card.dataset.day); card.querySelectorAll('.time-grid [data-field]').forEach((input) => input.addEventListener('change', () => { const field = input.dataset.field; currentEmployee().days[dayIndex][field] = field === 'pause' ? Number(input.value) : input.value; markDirty(); render(); })); card.querySelectorAll('.allocation').forEach((row) => { const allocationIndex = Number(row.dataset.allocation); row.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('change', () => { const field = input.dataset.field; currentEmployee().days[dayIndex].allocations[allocationIndex][field] = field === 'hours' ? Number(input.value) : input.value; markDirty(); render(); })); row.querySelector('[data-action="remove-allocation"]')?.addEventListener('click', () => { currentEmployee().days[dayIndex].allocations.splice(allocationIndex, 1); markDirty(); render(); }); }); card.querySelector('[data-action="add-allocation"]')?.addEventListener('click', () => { const order = state.week.orders.find((item) => item.active); if (order) currentEmployee().days[dayIndex].allocations.push({ orderId: order.id, hours: 0 }); markDirty(); render(); }); });
  const orderForm = content.querySelector('#order-form'); orderForm?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(orderForm); state.week.orders.push({ id: `manuell-${Date.now()}`, number: String(data.get('number')).trim(), name: String(data.get('name')).trim(), requester: String(data.get('requester')).trim(), active: true }); markDirty(); render(); });
  content.querySelectorAll('.order-card').forEach((card) => card.querySelector('[data-field="active"]')?.addEventListener('change', (event) => { const order = state.week.orders[Number(card.dataset.order)]; order.active = event.target.checked; markDirty(); render(); }));
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

loadWeeks().catch((error) => { state.loading = false; showNotice(error.message, true); render(); });
