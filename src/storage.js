import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = process.env.DATA_DIR || path.resolve('data');
const storePath = path.join(dataDirectory, 'store.json');
let writeQueue = Promise.resolve();

const emptyStore = () => ({ schemaVersion: 4, users: [], employees: [], weeks: {} });

function migrateStore(parsed) {
  const users = Array.isArray(parsed.users) ? parsed.users : [];
  const employees = Array.isArray(parsed.employees) ? parsed.employees : [];
  for (const user of users) {
    let employee = employees.find((item) => String(item.personnelNumber) === String(user.personnelNumber));
    if (!employee) {
      employee = { id: user.employeeId || user.id, name: user.name, personnelNumber: String(user.personnelNumber), active: user.active !== false, createdAt: user.createdAt || new Date().toISOString() };
      employees.push(employee);
    }
    user.employeeId = employee.id;
  }
  const weeks = parsed.weeks || {};
  for (const week of Object.values(weeks)) {
    week.orders = Array.isArray(week.orders) ? week.orders.map((order) => ({ description: '', requester: '', active: true, ...order })) : [];
  }
  return { ...parsed, schemaVersion: 4, users, employees, weeks };
}

export async function readStore() {
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const contents = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(contents);
    if (!parsed.weeks || typeof parsed.weeks !== 'object') throw new Error('Ungültiger Datenspeicher');
    return migrateStore(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

export function writeStore(store) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, storePath);
  });
  return writeQueue;
}

