import ExcelJS from 'exceljs';

function rawValue(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object' && 'result' in value) return value.result;
  if (value && typeof value === 'object' && 'text' in value) return value.text;
  return value;
}

function textValue(cell) {
  const value = rawValue(cell);
  return value === null || value === undefined ? '' : String(value).trim();
}

function numericValue(cell) {
  const value = rawValue(cell);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeValue(cell) {
  const value = rawValue(cell);
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  if (typeof value === 'number') {
    const minutes = Math.round((((value % 1) + 1) % 1) * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

function isoDate(cell) {
  const value = rawValue(cell);
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number') date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
  else date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function duration(start, end, pause) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
  if (minutes < 0) minutes += 1440;
  return Math.max(0, minutes / 60 - pause);
}

function findLabelRow(sheet, pattern) {
  for (let row = 1; row <= Math.min(sheet.rowCount, 60); row += 1) {
    for (let column = 1; column <= Math.min(sheet.columnCount, 12); column += 1) {
      if (pattern.test(textValue(sheet.getCell(row, column)))) return row;
    }
  }
  return 0;
}

function orderMetadata(sheet, index) {
  const contractRow = findLabelRow(sheet, /Kontrakt|Bestell/i);
  const number = contractRow ? textValue(sheet.getCell(contractRow + 1, 2)) : '';
  const requester = contractRow ? textValue(sheet.getCell(contractRow + 1, 5)) : '';
  const remarkRow = findLabelRow(sheet, /Bemerkung/i);
  const firstRemarkRow = remarkRow || 43;
  const remarks = [];
  for (let row = firstRemarkRow; row <= Math.min(sheet.rowCount, firstRemarkRow + 7); row += 1) {
    const line = textValue(sheet.getCell(row, 3));
    if (line && !remarks.includes(line)) remarks.push(line);
  }
  const name = remarks.shift() || sheet.name.trim();
  return { id: `auftrag-${index + 1}`, number, name, description: remarks.join('\n'), requester, active: true, sourceSheet: sheet.name };
}

function readAttendanceEmployees(sheet) {
  const employees = [];
  for (let row = 5; row <= sheet.rowCount - 2; row += 1) {
    const number = numericValue(sheet.getCell(row, 1));
    const name = textValue(sheet.getCell(row, 2));
    const marker = textValue(sheet.getCell(row, 3)).toLowerCase();
    if (!number || !name || marker !== 'von') continue;
    const days = [];
    for (let day = 0; day < 5; day += 1) {
      days.push({
        start: timeValue(sheet.getCell(row, 4 + day)),
        end: timeValue(sheet.getCell(row + 1, 4 + day)),
        pause: numericValue(sheet.getCell(row + 2, 4 + day)),
        allocations: [],
      });
    }
    employees.push({ id: String(number), name, days });
  }
  return employees;
}

function applyOrderAllocations(sheet, order, employeeMap) {
  let totalHours = 0;
  for (let row = 11; row <= Math.min(sheet.rowCount - 2, 50); row += 1) {
    const employeeId = String(numericValue(sheet.getCell(row, 1)) || '');
    const marker = textValue(sheet.getCell(row, 3)).toLowerCase();
    if (!employeeId || marker !== 'von' || !employeeMap.has(employeeId)) continue;
    const employee = employeeMap.get(employeeId);
    for (let day = 0; day < 5; day += 1) {
      const start = timeValue(sheet.getCell(row, 4 + day));
      const end = timeValue(sheet.getCell(row + 1, 4 + day));
      const pause = numericValue(sheet.getCell(row + 2, 4 + day));
      const hours = duration(start, end, pause);
      if (hours > 0) {
        const rounded = Math.round(hours * 10000) / 10000;
        employee.days[day].allocations.push({ orderId: order.id, hours: rounded });
        totalHours += rounded;
      }
    }
  }
  return totalHours;
}

export async function importWorkbook(buffer, fileName = 'import.xlsx') {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const attendance = workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === 'anwesenheit');
  if (!attendance) throw new Error('Das Tabellenblatt „Anwesenheit“ wurde nicht gefunden.');

  const weekNumber = Math.round(numericValue(attendance.getCell(2, 5)));
  const startDate = isoDate(attendance.getCell(2, 7));
  const endDate = isoDate(attendance.getCell(2, 10));
  if (!weekNumber || !startDate || !endDate) throw new Error('Kalenderwoche oder Datumsbereich konnten nicht gelesen werden.');

  const employees = readAttendanceEmployees(attendance);
  if (!employees.length) throw new Error('Es wurden keine Mitarbeiterzeilen gefunden.');
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const orders = [];

  const detailSheets = workbook.worksheets.filter((sheet) => !['anwesenheit', 'berechnungsgrundlagen'].includes(sheet.name.trim().toLowerCase()));
  detailSheets.forEach((sheet, index) => {
    const order = orderMetadata(sheet, index);
    const hours = applyOrderAllocations(sheet, order, employeeMap);
    if ((order.number && order.number !== '0') || hours > 0) orders.push(order);
  });

  const year = Number(startDate.slice(0, 4));
  return {
    id: `${year}-kw-${String(weekNumber).padStart(2, '0')}`,
    year,
    weekNumber,
    startDate,
    endDate,
    sourceFile: fileName,
    importedAt: new Date().toISOString(),
    employees,
    orders,
  };
}

