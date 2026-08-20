import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { config } from '../config';

// One connection pool for the process. postgres.js pools by default.
const client = postgres(config.databaseUrl);

export const db = drizzle(client, { schema });
export { schema };
