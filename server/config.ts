import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ENV_FILE = join(ROOT, '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const keys = (process.env.API_KEYS_511 ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

export const config = {
  apiKeys511: keys,
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? join(ROOT, 'data'),
  // The built frontend, read for the page shell that saved-search links get with results inlined.
  webDist: process.env.WEB_DIST ?? join(ROOT, 'dist'),
};

export function requireApiKeys() {
  if (config.apiKeys511.length === 0) {
    throw new Error(`Set API_KEYS_511 in ${ENV_FILE}, comma separated. Get keys at https://511.org/open-data/token`);
  }
  return config.apiKeys511;
}

// The agencies the site covers, by 511 operator id. Golden Gate Transit's ferries are a
// separate 511 operator (GF) from its buses (GG).
export const AGENCIES = ['SF', 'BA', 'SM', 'GG', 'GF'] as const;
export type Agency = (typeof AGENCIES)[number];

export const TIME_ZONE = 'America/Los_Angeles';
