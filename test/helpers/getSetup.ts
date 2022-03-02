import fs from 'fs/promises';
import { join } from 'path';
import { SetupConfig } from './interfaces.js';

const lockFile = join('test', 'servers.lock');

export default async function getConfig(): Promise<SetupConfig> {
  const data = await fs.readFile(lockFile, 'utf8');
  return JSON.parse(data);
}
