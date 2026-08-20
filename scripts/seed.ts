// Run with: npm run db:seed
import 'dotenv/config';
import { db } from '../src/lib/server/db/index';
import { seedDevData, SEED } from '../src/lib/server/db/seed';

await seedDevData(db);

console.log('Seeded:');
for (const company of SEED.companies) console.log(`  company  ${company.name}`);
for (const user of SEED.users) console.log(`  user     ${user.name}`);

process.exit(0);
