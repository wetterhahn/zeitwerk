import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = process.env.DATA_DIR || path.resolve('data');
const storePath = path.join(dataDirectory, 'store.json');
let writeQueue = Promise.resolve();

const emptyStore = () => ({ schemaVersion: 2, users: [], weeks: {} });

export async function readStore() {
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const contents = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(contents);
    if (!parsed.weeks || typeof parsed.weeks !== 'object') throw new Error('Ungültiger Datenspeicher');
    return { ...parsed, schemaVersion: 2, users: Array.isArray(parsed.users) ? parsed.users : [] };
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
