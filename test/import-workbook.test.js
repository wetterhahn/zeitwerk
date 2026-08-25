import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { importWorkbook } from '../src/import-workbook.js';

test('imports attendance, order metadata and daily allocation', async () => {
  const workbook = new ExcelJS.Workbook();
  const attendance = workbook.addWorksheet('Anwesenheit');
  attendance.getCell('E2').value = 25;
  attendance.getCell('G2').value = new Date('2026-06-15T00:00:00Z');
  attendance.getCell('J2').value = new Date('2026-06-19T00:00:00Z');
  attendance.getCell('A5').value = 101;
  attendance.getCell('B5').value = 'Beispielperson';
  attendance.getCell('C5').value = 'von';
  attendance.getCell('D5').value = 6.25 / 24;
  attendance.getCell('D6').value = 15.25 / 24;
  attendance.getCell('D7').value = 0.5;

  const detail = workbook.addWorksheet('10001 Beispielauftrag');
  detail.getCell('A11').value = 101;
  detail.getCell('B11').value = 'Beispielperson';
  detail.getCell('C11').value = 'Von';
  detail.getCell('D11').value = 6.25 / 24;
  detail.getCell('D12').value = 15.25 / 24;
  detail.getCell('D13').value = 0.5;
  detail.getCell('B40').value = 'Kontrakt./Bestell.Nr.:';
  detail.getCell('B41').value = 10001;
  detail.getCell('E41').value = 'Beispiel-Anforderer';
  detail.getCell('B43').value = 'Bemerkung:';
  detail.getCell('C43').value = 'Beispielauftrag';

  const buffer = await workbook.xlsx.writeBuffer();
  const result = await importWorkbook(buffer, 'beispiel.xlsx');

  assert.equal(result.id, '2026-kw-25');
  assert.equal(result.employees.length, 1);
  assert.equal(result.employees[0].id, '101');
  assert.equal(result.employees[0].days[0].start, '06:15');
  assert.equal(result.employees[0].days[0].end, '15:15');
  assert.equal(result.employees[0].days[0].allocations[0].hours, 8.5);
  assert.equal(result.orders[0].number, '10001');
  assert.equal(result.orders[0].name, 'Beispielauftrag');
});
