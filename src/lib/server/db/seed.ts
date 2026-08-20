import { companies, users } from './schema';
import type { db } from './index';

/** Hardcoded ids so the dev switch, the README and the tests refer to the same
 *  values, and re-seeding cannot duplicate them. */
export const SEED = {
	companies: [
		{ id: '00000000-0000-4000-8000-00000000000a', name: 'Hospital A' },
		{ id: '00000000-0000-4000-8000-00000000000b', name: 'Hospital B' }
	],
	users: [
		{
			id: '00000000-0000-4000-8000-0000000000a1',
			name: 'Dana (Hospital A)',
			companyId: '00000000-0000-4000-8000-00000000000a'
		},
		{
			id: '00000000-0000-4000-8000-0000000000b1',
			name: 'Ben (Hospital B)',
			companyId: '00000000-0000-4000-8000-00000000000b'
		}
	]
} as const;

/** The user the app falls back to when no dev user cookie is set. */
export const DEFAULT_USER_ID = SEED.users[0].id;

/** Idempotent, so it is safe on every boot. Companies before users. */
export async function seedDevData(database: typeof db): Promise<void> {
	await database
		.insert(companies)
		.values([...SEED.companies])
		.onConflictDoNothing();
	await database
		.insert(users)
		.values([...SEED.users])
		.onConflictDoNothing();
}
