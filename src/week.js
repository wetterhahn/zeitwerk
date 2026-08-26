function isoWeekStart(year, weekNumber) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekday = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - weekday + 1 + (weekNumber - 1) * 7);
  return monday;
}

const isoDate = (date) => date.toISOString().slice(0, 10);

export function createManualWeek({ year, weekNumber, employees }) {
  const numericYear = Number(year);
  const numericWeek = Number(weekNumber);
  if (!Number.isInteger(numericYear) || numericYear < 2020 || numericYear > 2100) throw new Error('Bitte ein gültiges Jahr eintragen.');
  if (!Number.isInteger(numericWeek) || numericWeek < 1 || numericWeek > 53) throw new Error('Bitte eine Kalenderwoche zwischen 1 und 53 eintragen.');
  const start = isoWeekStart(numericYear, numericWeek);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 4);
  const now = new Date().toISOString();
  return {
    id: `${numericYear}-kw-${String(numericWeek).padStart(2, '0')}`,
    sourceFile: null,
    source: 'manual',
    year: numericYear,
    weekNumber: numericWeek,
    startDate: isoDate(start),
    endDate: isoDate(end),
    importedAt: null,
    createdAt: now,
    updatedAt: now,
    employees: employees.filter((employee) => employee.active && !employee.hiddenFromTracking).map((employee) => ({
      id: employee.personnelNumber,
      name: employee.name,
      days: Array.from({ length: 5 }, () => ({ start: '', end: '', pause: 0, allocations: [] }))
    })),
    orders: []
  };
}
